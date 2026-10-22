import { hotelData } from "../data/hotel";
import { getFxRatesSync, refreshLiveFxRates } from "./fx-service";
import {
  fetchSumacInventory,
  selectOptimalRoomForGuests,
  type SumacInventorySnapshot
} from "./sumac-bridge";

export interface BookingState {
  checkIn: string;
  checkOut: string;
  guests: number;
  selectedRoomId: string;
  assignedRoomNumber: string | null;
  inventory: SumacInventorySnapshot | null;
  usdToPen: number;
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const checkOutDefault = new Date();
checkOutDefault.setDate(checkOutDefault.getDate() + 3);

const formatDateISO = (d: Date) => d.toISOString().split("T")[0];

function isValidIsoDateString(val: unknown): val is string {
  if (typeof val !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return false;
  }
  const parsed = new Date(`${val.trim()}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

// Por defecto 2 huéspedes → Atelier King Suite (matrimonial)
const defaultRoomFor2 =
  hotelData.rooms.find((r) => r.sumacRoomType === "matrimonial") || hotelData.rooms[0];

const state: BookingState = {
  checkIn: formatDateISO(tomorrow),
  checkOut: formatDateISO(checkOutDefault),
  guests: 2,
  selectedRoomId: defaultRoomFor2.id,
  assignedRoomNumber: "201",
  inventory: null,
  usdToPen: getFxRatesSync().usdToPen
};

export function getBookingState(): BookingState {
  return { ...state };
}

export function getNightsCount(): number {
  if (!isValidIsoDateString(state.checkIn) || !isValidIsoDateString(state.checkOut)) {
    throw new Error("Fechas de estancia inválidas.");
  }
  const start = new Date(`${state.checkIn}T00:00:00Z`);
  const end = new Date(`${state.checkOut}T00:00:00Z`);
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 1;
}

function emitBookingChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("booking:change", {
        detail: { ...state, nights: getNightsCount() }
      })
    );
  }
}

export async function syncInventoryWithSumac(forceMatchByGuests = false): Promise<void> {
  const snapshot = await fetchSumacInventory(state.checkIn, state.checkOut, state.guests);
  state.inventory = snapshot;
  state.usdToPen = getFxRatesSync().usdToPen;

  const optimal = selectOptimalRoomForGuests(
    state.guests,
    state.selectedRoomId,
    snapshot,
    forceMatchByGuests
  );
  state.selectedRoomId = optimal.selectedRoomId;
  state.assignedRoomNumber = optimal.assignedRoomNumber;
  emitBookingChange();
}

export function updateBookingState(partial: Partial<BookingState>) {
  if (partial.checkIn !== undefined && !isValidIsoDateString(partial.checkIn)) {
    throw new Error("La fecha de llegada no es válida.");
  }
  if (partial.checkOut !== undefined && !isValidIsoDateString(partial.checkOut)) {
    throw new Error("La fecha de salida no es válida.");
  }

  const guestsChanged =
    partial.guests !== undefined && partial.guests !== state.guests;
  const datesChanged =
    (partial.checkIn !== undefined && partial.checkIn !== state.checkIn) ||
    (partial.checkOut !== undefined && partial.checkOut !== state.checkOut);

  Object.assign(state, partial);

  if (new Date(`${state.checkOut}T00:00:00Z`) <= new Date(`${state.checkIn}T00:00:00Z`)) {
    const nextDay = new Date(`${state.checkIn}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    state.checkOut = formatDateISO(nextDay);
  }

  if (state.inventory && state.inventory.ok) {
    if (guestsChanged) {
      for (const webRoom of hotelData.rooms) {
        const rType = webRoom.sumacRoomType;
        const item = state.inventory.byRoomType[rType];
        if (item) {
          const hasCap = webRoom.capacity >= state.guests;
          item.suitableForGuests = hasCap && item.availableCount > 0;
          item.reasonIfUnavailable = !hasCap
            ? "aforo_insuficiente"
            : item.availableCount === 0
              ? "agotada_en_sumac"
              : undefined;
        }
      }
    }
    const optimal = selectOptimalRoomForGuests(
      state.guests,
      state.selectedRoomId,
      state.inventory,
      guestsChanged
    );
    state.selectedRoomId = optimal.selectedRoomId;
    state.assignedRoomNumber = optimal.assignedRoomNumber;
  } else if (guestsChanged) {
    const exact =
      hotelData.rooms.find((r) => r.capacity === state.guests) ||
      hotelData.rooms.find((r) => r.capacity >= state.guests) ||
      hotelData.rooms[0];
    state.selectedRoomId = exact.id;
  }

  emitBookingChange();

  if (guestsChanged || datesChanged) {
    syncInventoryWithSumac(guestsChanged).catch(() => undefined);
  }
}

let syncStarted = false;
export function startLiveBookingSync() {
  if (typeof window === "undefined" || syncStarted) return;
  syncStarted = true;

  refreshLiveFxRates().then((rates) => {
    state.usdToPen = rates.usdToPen;
    emitBookingChange();
  });

  syncInventoryWithSumac(false).catch(() => undefined);

  setInterval(() => {
    if (document.visibilityState === "visible") {
      syncInventoryWithSumac(false).catch(() => undefined);
    }
  }, 5000);
}

export function buildCheckoutUrl(): string {
  const url = new URL(hotelData.bookingBaseUrl);
  url.searchParams.set("checkin", state.checkIn);
  url.searchParams.set("checkout", state.checkOut);
  url.searchParams.set("adults", String(state.guests));
  url.searchParams.set("room", state.selectedRoomId);
  return url.toString();
}
