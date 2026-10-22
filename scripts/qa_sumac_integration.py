import json
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

WEB_HOTEL_URL = "http://localhost:4321"
SUMAC_API_URL = "http://127.0.0.1:3000/api/public-booking"


def api_get(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_post(url: str, payload: dict):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_qa():
    print("=== INICIANDO QA AUTOMATIZADO END-TO-END (FASES 1 A 6) ===")

    # 1. Verificar API de Sumac Gestión en puerto 3000
    print("\n[FASE 2] Verificando conexión y semilla de habitaciones en Sumac Gestión (localhost:3000)...")
    inv = api_get(SUMAC_API_URL)
    assert inv.get("ok") is True, f"Sumac API falló: {inv}"
    rooms = inv.get("rooms", [])
    assert len(rooms) >= 10, f"Se esperaban >=10 habitaciones en Sumac, encontradas: {len(rooms)}"
    room_types = {r["type"] for r in rooms}
    for expected_type in ("simple", "matrimonial", "doble", "triple", "suite_familiar"):
        assert expected_type in room_types, f"Falta tipo {expected_type} en Sumac"
    print(f"  ✓ Sumac Gestión activo con {len(rooms)} habitaciones en S/ PEN: {sorted(list(room_types))}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        print("\n[FASE 1] Verificando precios en $ USD y conversión S/ PEN en WEB Hotel (localhost:4321)...")
        page.goto(WEB_HOTEL_URL, wait_until="networkidle")
        page.wait_for_timeout(1000)

        header_text = page.locator("#header-booking-label").inner_text()
        assert "$" in header_text and "USD" in header_text, f"Header no muestra $ USD: {header_text}"
        final_total = page.locator("#final-total-price").inner_text()
        assert "$" in final_total and "USD" in final_total, f"Total final no está en $ USD: {final_total}"
        pen_equiv = page.locator("#final-pen-equivalent").inner_text()
        assert "S/" in pen_equiv and "PEN" in pen_equiv, f"Equivalente PEN no visible: {pen_equiv}"
        print(f"  ✓ Header: '{header_text}' | Total Final: '{final_total}' | Equivalente: '{pen_equiv}'")

        # FASE 3: Motor de Aforo por Cantidad de Huéspedes (1 -> 2 -> 3 -> 4)
        print("\n[FASE 3] Probando Motor de Aforo por Cantidad de Huéspedes (1, 2, 3 y 4 Huéspedes)...")

        # Caso 1 Huésped -> Simple (Hab. 101, $140 USD)
        page.select_option("#final-guests", "1")
        page.wait_for_timeout(800)
        status_1 = page.locator("#final-sumac-status").inner_text()
        total_1 = page.locator("#final-total-price").inner_text()
        assert "Simple" in status_1 or "101" in status_1, f"1 Huésped no auto-seleccionó Simple: {status_1}"
        assert "$280 USD" in total_1, f"1 Huésped × 2 noches debería ser $280 USD, obtenido: {total_1}"
        print(f"  ✓ 1 Huésped → {status_1} | Total 2 noches: {total_1}")

        # Caso 2 Huéspedes -> Matrimonial (Hab. 201, $260 USD) y Simple deshabilitada
        page.select_option("#final-guests", "2")
        page.wait_for_timeout(800)
        status_2 = page.locator("#final-sumac-status").inner_text()
        simple_card_selectable = page.locator('.room-card[data-sumac-type="simple"]').get_attribute("data-selectable")
        assert simple_card_selectable == "false", "Habitación Simple debería estar deshabilitada para 2 huéspedes"
        assert "Matrimonial" in status_2, f"2 Huéspedes no seleccionó Matrimonial: {status_2}"
        print(f"  ✓ 2 Huéspedes → {status_2} (Simple deshabilitada por aforo máx. 1 pers.)")

        # Prueba en vivo Fase 2: Poner Hab. 201 en_mantenimiento en Sumac y verificar salto a Hab. 202
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "201", "status": "en_mantenimiento"})
        page.select_option("#final-guests", "1")
        page.wait_for_timeout(400)
        page.select_option("#final-guests", "2")
        page.wait_for_timeout(900)
        status_2_maint = page.locator("#final-sumac-status").inner_text()
        assert "202" in status_2_maint, f"Al poner 201 en_mantenimiento no saltó a 202: {status_2_maint}"
        print(f"  ✓ Cambio en vivo en Sumac (Hab. 201 en_mantenimiento) → Web saltó a: {status_2_maint}")
        # Restaurar 201
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "201", "status": "disponible"})

        # Caso 3 Huéspedes -> Triple (Hab. 301, $340 USD) y Simple/Matrimonial/Doble deshabilitadas
        page.select_option("#final-guests", "3")
        page.wait_for_timeout(900)
        status_3 = page.locator("#final-sumac-status").inner_text()
        mat_selectable = page.locator('.room-card[data-sumac-type="matrimonial"]').get_attribute("data-selectable")
        dob_selectable = page.locator('.room-card[data-sumac-type="doble"]').get_attribute("data-selectable")
        assert mat_selectable == "false" and dob_selectable == "false", "Matrimonial y Doble deben deshabilitarse con 3 huéspedes"
        assert "Triple" in status_3 and ("301" in status_3 or "302" in status_3), f"3 Huéspedes no seleccionó Triple: {status_3}"
        print(f"  ✓ 3 Huéspedes → {status_3} (Simple, Matrimonial y Doble deshabilitadas)")

        # Prueba de salto automático si las Triples están ocupadas en Sumac -> salta a Suite Familiar (Cap. 4)
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "301", "status": "ocupada"})
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "302", "status": "ocupada"})
        page.select_option("#final-guests", "2")
        page.wait_for_timeout(400)
        page.select_option("#final-guests", "3")
        page.wait_for_timeout(900)
        status_3_upgrade = page.locator("#final-sumac-status").inner_text()
        assert "Suite Familiar" in status_3_upgrade, f"Con Triples ocupadas no saltó a Suite Familiar: {status_3_upgrade}"
        print(f"  ✓ Con Triples (301/302) ocupadas en Sumac → 3 Huéspedes saltó automáticamente a: {status_3_upgrade}")
        # Restaurar 301 y 302
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "301", "status": "disponible"})
        api_post(SUMAC_API_URL, {"action": "updateRoomStatus", "roomNumber": "302", "status": "disponible"})

        # Caso 4 Huéspedes -> Suite Familiar (Hab. 401, $390 USD)
        page.select_option("#final-guests", "4")
        page.wait_for_timeout(900)
        status_4 = page.locator("#final-sumac-status").inner_text()
        triple_selectable = page.locator('.room-card[data-sumac-type="triple"]').get_attribute("data-selectable")
        assert triple_selectable == "false", "Triple debe deshabilitarse con 4 huéspedes"
        assert "Suite Familiar" in status_4, f"4 Huéspedes no seleccionó Suite Familiar: {status_4}"
        print(f"  ✓ 4 Huéspedes → {status_4} (Solo Suite Familiar habilitada)")

        # Volver a 3 Huéspedes para probar Checkout e Inyección en Sumac Gestión (Fase 4 y Fase 5)
        page.select_option("#final-guests", "3")
        page.wait_for_timeout(900)

        print("\n[FASE 4 & 5] Ejecutando Checkout Multi-Chain ($0.02 USD Arbitrum Micro-Test) e inyección en S/ PEN en Sumac...")
        page.locator("#final-checkout-btn").click()
        page.wait_for_timeout(500)

        modal_visible = page.locator("#checkout-modal-backdrop").is_visible()
        assert modal_visible, "El modal de Checkout no se abrió"

        crypto_preview = page.locator("#checkout-crypto-amount-preview").inner_text()
        assert "0.02 USDC" in crypto_preview and "Arbitrum" in crypto_preview, f"Preview cripto inesperado: {crypto_preview}"
        print(f"  ✓ Modal Checkout abierto · Modo activo: {crypto_preview}")

        # Rellenar datos del huésped y confirmar pago
        page.fill("#checkout-guest-name", "Carlos Alcaraz Web3")
        page.fill("#checkout-doc-number", "ESP-778899")
        page.locator("#btn-pay-instant").click()

        # Esperar panel de recibo exitoso
        page.locator("#checkout-success-panel").wait_for(state="visible", timeout=10000)
        receipt_code = page.locator("#receipt-code").inner_text()
        receipt_room = page.locator("#receipt-room").inner_text()
        receipt_pen = page.locator("#receipt-pen").inner_text()
        receipt_tx = page.locator("#receipt-tx-link").inner_text()

        assert receipt_code.startswith("RES-WEB-"), f"Código de reserva inválido: {receipt_code}"
        assert "S/ 2,550" in receipt_pen or "S/ 2550" in receipt_pen or "2,550" in receipt_pen or "2.550" in receipt_pen, f"Monto en Soles incorrecto: {receipt_pen}"
        assert receipt_tx.startswith("0x") and len(receipt_tx) == 66, f"TxHash inválido: {receipt_tx}"
        print(f"  ✓ Reserva confirmada: {receipt_code} | {receipt_room} | {receipt_pen} | Tx: {receipt_tx[:18]}...")

        # Verificar en la base de datos SQLite de Sumac Gestión que la reserva y la nota existen
        inv_after = api_get(SUMAC_API_URL)
        created_res = next(
            (r for r in inv_after.get("reservations", []) if r.get("code") == receipt_code),
            None,
        )
        assert created_res is not None, f"La reserva {receipt_code} no se encontró en Sumac Gestión"
        assert created_res["channel"] == "directo_web"
        assert created_res["isPaidOnline"] is True
        assert created_res["totalAmount"] == 2550, f"Total en Sumac debía ser 2550 PEN, fue: {created_res['totalAmount']}"
        assert created_res["roomTypeRequested"] == "triple"
        print(
            f"  ✓ Verificado en Sumac Gestión SQLite: {created_res['code']} · Huésped: {created_res['guestName']} · "
            f"Hab. {created_res['assignedRoomNumber']} · S/ {created_res['totalAmount']} PEN · Canal: {created_res['channel']}"
        )

        browser.close()

    print("\n=== TODAS LAS PRUEBAS E2E (FASES 1 A 6) PASARON EXITOSAMENTE ===")


if __name__ == "__main__":
    try:
        run_qa()
    except Exception as exc:
        print(f"\n[ERROR QA]: {exc}", file=sys.stderr)
        sys.exit(1)
