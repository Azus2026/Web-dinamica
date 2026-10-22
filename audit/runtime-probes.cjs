// Audit probes: execute the existing TypeScript in a sandbox with mocked I/O.
// No wallet, payment, external API, or database is contacted.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let clockMs = 0;
const cache = new Map();
const sandbox = vm.createContext({
  console, URL, Map, Set, Date: class extends Date {
    static now() { return clockMs; }
  },
  setTimeout(fn, ms) { clockMs += ms; fn(); return 0; },
  fetch: async () => { throw new Error('API unavailable (audit mock)'); },
});

function load(relativePath) {
  const filename = path.resolve(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  let source = fs.readFileSync(filename, 'utf8');
  // Expose this private helper only inside the audit VM, without changing source.
  if (filename.endsWith('web3-checkout.ts')) source += '\nexport { waitForOnChainReceipt };';
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  cache.set(filename, module);
  const wrapper = vm.runInContext(`(function(require, module, exports) { ${output}\n})`, sandbox, { filename });
  wrapper((specifier) => {
    if (!specifier.startsWith('.')) throw new Error('Unexpected external import');
    const target = path.resolve(path.dirname(filename), specifier + '.ts');
    return load(path.relative(root, target));
  }, module, module.exports);
  return module.exports;
}

async function main() {
  const web3 = load('src/scripts/web3-checkout.ts');
  const bridge = load('src/scripts/sumac-bridge.ts');
  const store = load('src/scripts/booking-store.ts');
  const results = [];
  const record = (name, passed, observed) => results.push({ name, passed, observed });

  const receipt = await web3.waitForOnChainReceipt({ request: async () => null }, '0xMock', 45000);
  record('Unconfirmed transaction must not be confirmed after timeout', receipt.confirmed === false, receipt);

  let revertedRejected = false;
  try {
    await web3.waitForOnChainReceipt({ request: async () => ({ status: '0x0' }) }, '0xMock');
  } catch { revertedRejected = true; }
  record('Reverted transaction is rejected (control)', revertedRejected, { revertedRejected });

  const snapshot = await bridge.fetchSumacInventory('2030-01-01', '2030-01-03', 2);
  const offered = Object.values(snapshot.byRoomType).some((item) => item.suitableForGuests);
  record('Unavailable inventory API must not offer confirmed availability', !snapshot.ok || !offered, {
    source: snapshot.source, ok: snapshot.ok, offered, availableRooms: snapshot.availableRooms.length,
  });

  let rejectedInvalidDates = false;
  try { store.updateBookingState({ checkIn: '', checkOut: '' }); }
  catch { rejectedInvalidDates = true; }
  const state = store.getBookingState();
  record('Empty dates must be rejected before producing a quote', rejectedInvalidDates || Boolean(state.checkIn && state.checkOut), {
    checkIn: state.checkIn, checkOut: state.checkOut, quotedNights: store.getNightsCount(),
  });

  const simulated = web3.simulateVerifiedWeb3Payment({ fullReservationUsd: 520, chainId: 'arbitrum', token: 'USDC', mode: 'arbitrum_micro' });
  record('Simulation explicitly flags that it is not a real wallet transaction (control)', simulated.isRealWalletTx === false, {
    reservationUsd: 520, chargedUsd: simulated.chargedUsd, isRealWalletTx: simulated.isRealWalletTx,
  });

  // A Solana checkout must never submit an EVM transfer on the active wallet.
  let evmTransfers = 0;
  const provider = {
    async request({ method }) {
      if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0xa4b1';
      if (method === 'eth_getBalance') return '0x56bc75e2d63100000';
      if (method === 'eth_call') return '0x0';
      if (method === 'eth_sendTransaction') { evmTransfers++; return '0xMock'; }
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x1' };
      throw new Error('Unexpected mock method: ' + method);
    },
  };
  sandbox.Event = class { constructor(type) { this.type = type; } };
  sandbox.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  sandbox.window = { ethereum: provider, addEventListener() {}, dispatchEvent() {} };
  let wrongNetworkResult;
  try {
    wrongNetworkResult = await web3.executeWeb3WalletPayment({ fullReservationUsd: 520, chainId: 'solana', token: 'USDC', mode: 'full_amount' });
  } catch (error) { wrongNetworkResult = { rejected: error.message }; }
  record('Selecting Solana must not send an EVM payment on Arbitrum', evmTransfers === 0, {
    evmTransfers, reportedChain: wrongNetworkResult.chainName, reportedToken: wrongNetworkResult.token,
    rejected: wrongNetworkResult.rejected,
  });

  const report = { mockedIO: true, results, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length };
  fs.writeFileSync(path.join(__dirname, 'runtime-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.some((r) => !r.passed) ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 2; });
