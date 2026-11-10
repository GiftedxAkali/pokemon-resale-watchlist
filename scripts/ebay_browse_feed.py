#!/usr/bin/env python3
"""Official eBay Browse API -> Pokémon Buying Opportunities JSON feed.

Requires approved production Buy Browse API access.
Secrets: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET.
No unofficial scraping or sold-price claims.
"""
import base64, datetime as dt, json, os, re, sys, time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
NOW = dt.datetime.now(dt.timezone.utc).isoformat()
USER_AGENT = "PokemonResaleWatchlist/1.0 (official eBay Browse API)"
CLIENT_ID = os.environ.get("EBAY_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("EBAY_CLIENT_SECRET", "").strip()
MAX_CARDS = min(100, max(1, int(os.environ.get("EBAY_SCAN_CARD_LIMIT", "25"))))
LIMIT = min(50, max(5, int(os.environ.get("EBAY_RESULTS_PER_CARD", "15"))))
SLEEP = float(os.environ.get("EBAY_REQUEST_DELAY", "0.25"))
OUTPUT = ROOT / "ebay-listings.json"
UNSAFE = re.compile(r"\b(psa|bgs|cgc|graded|slab|proxy|custom|replica|reprint|japanese|korean|chinese|digital|code|lot|bundle|mystery|booster|pack|box|case|playset|fan art|orica)\b", re.I)

def fetch(url, headers=None, data=None):
    req = Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urlopen(req, timeout=25) as response:
            return json.load(response)
    except HTTPError as error:
        body = error.read(500).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} from eBay: {body}") from error

def token():
    if not CLIENT_ID or not CLIENT_SECRET:
        raise RuntimeError("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET GitHub Actions secrets")
    auth = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    result = fetch("https://api.ebay.com/identity/v1/oauth2/token",
                   {"Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded"},
                   urlencode({"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"}).encode())
    return result["access_token"]

def normalize(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

def eligible_title(card, title):
    low = title.lower()
    if UNSAFE.search(title) or re.search(r"\b(1st edition|first edition)\b", low):
        return False
    # Exact local card ID and total are preferred: do not cross-match print variants.
    number = str(card.get("number", "")).strip()
    if "/" not in number:
        return False
    local, total = (v.strip() for v in number.split("/", 1))
    # Accept card number only if listing spells the denominator too.
    if not re.search(r"(?<!\w)" + re.escape(local) + r"\s*/\s*" + re.escape(total) + r"(?!\d)", title, re.I):
        return False
    name = str(card.get("card", "")).strip()
    # Exact species and card suffix, e.g. Charizard ex, must both appear.
    for word in re.findall(r"[a-z0-9]+", name.lower()):
        if not re.search(r"\b" + re.escape(word) + r"\b", low):
            return False
    # Set-name check: reject names with no set evidence; false negatives are safer.
    significant = [w for w in re.findall(r"[a-z0-9]+", str(card.get("set", "")).lower()) if len(w) > 2 and w not in ("the", "and", "pokemon")]
    if significant and not all(re.search(r"\b" + re.escape(w) + r"\b", low) for w in significant):
        return False
    return True

def search(card, access_token):
    q = f'{card["card"]} {card["number"]} {card["set"]}'[:100]
    parameters = urlencode({"q": q, "limit": str(LIMIT), "sort": "price",
                            "filter": "buyingOptions:{FIXED_PRICE},itemLocationCountry:US"})
    headers = {"Authorization": "Bearer " + access_token,
               "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
               "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS%2Czip%3D77080",
               "Accept": "application/json"}
    return fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?" + parameters, headers)

def convert(card, item):
    title = item.get("title", "")
    if not eligible_title(card, title):
        return None
    price = item.get("price") or {}
    if price.get("currency") != "USD":
        return None
    try:
        ask = float(price["value"])
    except (KeyError, TypeError, ValueError):
        return None
    if ask <= 0 or not item.get("itemWebUrl"):
        return None
    # Shipping options vary by destination; never silently assume free shipping.
    ship_options = item.get("shippingOptions") or []
    costs = []
    for opt in ship_options:
        cost = opt.get("shippingCost") or {}
        if cost.get("currency") == "USD":
            try:
                costs.append(float(cost["value"]))
            except (TypeError, ValueError):
                pass
    if not costs:
        return None  # shipping not verifiable: fail closed
    return {"card": card["card"], "set": card["set"], "number": card["number"],
            "ask": round(ask, 2), "shipping": round(min(costs), 2),
            "source": "eBay Browse API", "condition": "Unverified",
            "url": item["itemWebUrl"], "observedAt": NOW,
            "notes": f"Title: {title[:180]}. Condition and exact variant MUST be manually verified."}

def main():
    with (ROOT / "data.json").open(encoding="utf-8") as handle:
        cards = json.load(handle)["cards"][:MAX_CARDS]
    access_token = token()
    found = []
    errors = []
    for index, card in enumerate(cards, 1):
        try:
            data = search(card, access_token)
            for item in data.get("itemSummaries", []):
                listing = convert(card, item)
                if listing:
                    found.append(listing)
            print(f"{index}/{len(cards)} {card['card']}: {len(data.get('itemSummaries', []))} returned")
        except Exception as error:
            errors.append(f"{card.get('card')} {card.get('number')}: {error}")
            print(errors[-1], file=sys.stderr)
            if "403" in str(error) or "401" in str(error):
                raise RuntimeError("eBay production Browse access is not enabled or credentials are rejected") from error
        time.sleep(SLEEP)
    if errors and len(errors) >= len(cards) // 2:
        raise RuntimeError(f"Too many failed searches ({len(errors)}/{len(cards)}); leaving previous feed unchanged")
    # Prevent duplicates from overlapping card queries.
    unique = {entry["url"]: entry for entry in found}
    payload = {"updatedAt": NOW, "source": "eBay official Browse API (production)",
               "status": "live_search_results_unverified", "cardsScanned": len(cards),
               "warnings": errors[:10], "listings": list(unique.values())}
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(OUTPUT)
    print(f"Wrote {len(unique)} unverified listings from {len(cards)} cards")

if __name__ == "__main__":
    main()
