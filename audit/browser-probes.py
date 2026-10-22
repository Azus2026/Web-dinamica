"""Audit the built site with every non-local request mocked or blocked."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:44321"
results = []
posts = []

def record(name, passed, observed):
    results.append({"name": name, "passed": bool(passed), "observed": observed})

def isolated_route(route):
    request = route.request
    if request.url.startswith(BASE + "/"):
        route.continue_()
    elif "/api/public-booking" in request.url and request.method == "POST":
        payload = request.post_data_json
        posts.append(payload)
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "ok": True,
            "reservation": {
                "id": "audit-mock", "code": "AUDIT-MOCK", "assignedRoomNumber": "201",
                "roomTypeRequested": payload["roomTypeRequested"],
                "totalAmount": payload["totalAmountPen"],
            },
            "shiftNote": {"id": "audit-mock", "message": "No real database used"},
        }))
    else:
        route.abort()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    desktop.route("**/*", isolated_route)
    page = desktop.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    response = page.goto(BASE, wait_until="domcontentloaded")
    page.locator("#hero-direct-book-btn").wait_for()
    page.wait_for_timeout(700)
    record("Homepage and client scripts load", response.status == 200 and not errors, {"status": response.status, "pageErrors": errors})
    for guests, expected in [(1, "$280 USD"), (2, "$520 USD"), (3, "$680 USD"), (4, "$780 USD")]:
        page.select_option("#hero-guests", str(guests))
        page.wait_for_timeout(200)
        actual = page.locator("#final-total-price").inner_text()
        record(f"Quote synchronizes for {guests} guests", actual == expected, {"expected": expected, "actual": actual})
    page.select_option("#hero-guests", "2")
    page.wait_for_timeout(200)
    page.locator("#hero-direct-book-btn").click()
    record("Checkout opens", page.locator("#checkout-modal-backdrop").is_visible(), {})
    page.keyboard.press("Escape")
    record("Checkout closes with Escape", not page.locator("#checkout-modal-backdrop").is_visible(), {})
    if not page.locator("#checkout-modal-backdrop").is_visible():
        page.locator("#hero-direct-book-btn").click()
    page.fill("#checkout-guest-name", "")
    page.fill("#checkout-doc-number", "")
    page.locator("#btn-pay-instant").click()
    page.wait_for_timeout(400)
    record("Production flow must block simulated reservation submissions", len(posts) == 0, {
        "mockedReservationPostCount": len(posts),
        "posted": [{"action": x.get("action"), "totalAmountUsd": x.get("totalAmountUsd"),
                    "paymentModeLabel": x.get("paymentModeLabel"),
                    "fallbackGuestAccepted": x.get("guestName") == "Huésped Web Directo",
                    "fallbackDocumentAccepted": x.get("docNumber", "").startswith("WEB-")}
                   for x in posts],
        "successPanelVisibleWithMockedAPI": page.locator("#checkout-success-panel").is_visible(),
    })
    for route in ["/legal", "/privacidad", "/cookies", "/condiciones-reserva"]:
        status = desktop.request.get(BASE + route).status
        record(f"Published legal link exists: {route}", status == 200, {"status": status})
    if page.locator("#receipt-close-btn").is_visible():
        page.locator("#receipt-close-btn").click()
    elif page.locator("#checkout-modal-close").is_visible():
        page.locator("#checkout-modal-close").click()
    page.screenshot(path=str(ROOT / "audit" / "desktop.png"))

    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
    mobile.route("**/*", isolated_route)
    page_m = mobile.new_page()
    page_m.goto(BASE, wait_until="domcontentloaded")
    page_m.locator("#hero-direct-book-btn").wait_for()
    page_m.wait_for_timeout(700)
    widths = page_m.evaluate("({viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth})")
    record("Mobile has no horizontal overflow", widths["document"] <= widths["viewport"], widths)
    record("Mobile booking action is in viewport", page_m.locator("#hero-direct-book-btn").evaluate("el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }"), page_m.locator("#hero-direct-book-btn").bounding_box())
    page_m.screenshot(path=str(ROOT / "audit" / "mobile.png"))
    browser.close()

report = {"externalTrafficMockedOrBlocked": True, "browser": "Chromium", "results": results,
          "passed": sum(x["passed"] for x in results), "failed": sum(not x["passed"] for x in results)}
(ROOT / "audit" / "browser-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(1 if report["failed"] else 0)
