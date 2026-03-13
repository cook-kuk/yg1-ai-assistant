"""
Integrate YG-1 product database dump (merge_smart_catalog.xlsx) into products.json
Extracts Milling products from prod_edp sheet (sheet5) + milling options (sheet7)
"""
import zipfile
import xml.etree.ElementTree as ET
import json
import os
import re

XLSX_PATH = "C:/Users/kuksh/Downloads/merge_smart_catalog.xlsx"
PRODUCTS_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "normalized", "products.json")

z = zipfile.ZipFile(XLSX_PATH)
ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def gcv(cell):
    v = cell.find(f'{ns}v')
    if v is not None and v.text:
        return v.text
    is_elem = cell.find(f'{ns}is')
    if is_elem is not None:
        texts = is_elem.findall(f'.//{ns}t')
        return ''.join(t.text or '' for t in texts)
    return ''

# ── Step 1: Read prod_edp (sheet5) - extract unique Milling products ──
print("Step 1: Reading prod_edp (656k rows)...")
f = z.open('xl/worksheets/sheet5.xml')
context = ET.iterparse(f, events=('end',))
headers = None
row_count = 0
products_raw = {}  # edp_no -> first occurrence row data

for event, elem in context:
    if elem.tag == f'{ns}row':
        cells = elem.findall(f'{ns}c')
        vals = [gcv(c) for c in cells]
        if row_count == 0:
            headers = vals
        else:
            cat = vals[1] if len(vals) > 1 else ''
            edp = vals[7] if len(vals) > 7 else ''
            deleted = vals[54] if len(vals) > 54 else ''
            show = vals[56] if len(vals) > 56 else ''

            if cat == 'Milling' and edp and len(edp) > 3 and edp != '1':
                if deleted == 'Y':
                    pass  # skip deleted
                elif edp not in products_raw:
                    products_raw[edp] = dict(zip(headers, vals))

        row_count += 1
        if row_count % 200000 == 0:
            print(f"  ...{row_count} rows, {len(products_raw)} unique products")
        elem.clear()

f.close()
print(f"  Total: {len(products_raw)} unique Milling products from prod_edp")

# ── Step 2: Read prod_edp_option_milling (sheet7) for additional specs ──
print("\nStep 2: Reading prod_edp_option_milling...")
f2 = z.open('xl/worksheets/sheet7.xml')
context2 = ET.iterparse(f2, events=('end',))
mill_headers = None
mill_row = 0
milling_options = {}  # edp_idx -> option data

for event, elem in context2:
    if elem.tag == f'{ns}row':
        cells = elem.findall(f'{ns}c')
        vals = [gcv(c) for c in cells]
        if mill_row == 0:
            mill_headers = vals
            print(f"  Milling option headers: {vals[:15]}")
        else:
            if len(vals) > 1:
                edp_idx = vals[0] if vals[0] else ''
                if edp_idx and edp_idx not in milling_options:
                    milling_options[edp_idx] = dict(zip(mill_headers, vals))
        mill_row += 1
        if mill_row % 200000 == 0:
            print(f"  ...{mill_row} rows")
        elem.clear()

f2.close()
print(f"  Total: {len(milling_options)} milling option records")

# ── Step 3: Read prod_series_work_material_statu (sheet16) for material tags ──
print("\nStep 3: Reading work material status...")
f3 = z.open('xl/worksheets/sheet16.xml')
context3 = ET.iterparse(f3, events=('end',))
wm_headers = None
wm_row = 0
series_materials = {}  # series_idx -> set of ISO groups

for event, elem in context3:
    if elem.tag == f'{ns}row':
        cells = elem.findall(f'{ns}c')
        vals = [gcv(c) for c in cells]
        if wm_row == 0:
            wm_headers = vals
            print(f"  Headers: {vals[:10]}")
        else:
            if len(vals) > 2:
                series_idx = vals[0] if vals[0] else ''
                # material status fields
                if series_idx:
                    if series_idx not in series_materials:
                        series_materials[series_idx] = set()
                    # Check all material columns for 'Y' or positive values
                    for i in range(1, min(len(vals), len(wm_headers))):
                        h = wm_headers[i] if i < len(wm_headers) else ''
                        v = vals[i]
                        if v and v not in ('N', '0', ''):
                            series_materials[series_idx].add(h)
        wm_row += 1
        elem.clear()

f3.close()
print(f"  Series with material data: {len(series_materials)}")

z.close()

# ── Step 4: Build normalized products ──
print("\nStep 4: Building normalized products...")

# Read existing products
existing = json.loads(open(PRODUCTS_PATH, 'r', encoding='utf-8').read())
existing_ids = set(p['id'] for p in existing)
existing_edps = set(p.get('normalizedCode', '') for p in existing)
print(f"  Existing products: {len(existing)}")

# Image series set
IMAGE_SERIES = set([
    "CE7659","CE7406","CE7401","CE7412","CE7A63","CGPH02","CGPH01","E2498","E2030","E2406",
    "E2031","E2032","E2412","E2463","E2401","E2509","E2462","E2461","E2750","E2480","CGPH38",
    "E2751","E2749","E2464","E2659","E2411","E2714","E2753","E5D73","E5D71","E5D80","E2752",
    "E2759","E2754","E2756","E2760","E2755","E5D70","E2762","E5D72","E2806","E2768","E5D78",
    "E5D79","E5D74","E2758","E5E88","E5E84","E5E89","EHD84","E5E83","E5E87","EHD85","EHD87",
    "EIE21","EIE24","EIE23","EIE22","EL612","EIE25","EMD88","EIE37","EIE26","EIE38","EMD81",
    "EIE27","EMD83","EMD92","EMD82","EMH78","EMH79","EMH77","ESE94","ESE93","GAC25","GA931",
    "GAA22","GAD33","GAD52","GAB58","GA932","GMG86","GMH62","GMH63","GMG87","GMG30","GMG40",
    "GMG26","GMH60","GMH61","GMH42","GMH64","GNX35","GNX36","GNX01","GNX66","GNX46","GNX61",
    "GNX64","GNX73","GNX67","GNX98","GNX45","GMI41","GNX75","GNX74","GMI47","GNX99","SEM810",
    "SEM813","SEM846","SEMD98","SEM818","SEM838","SEM816","SEM845","SEM811","SEM812","SEM817",
    "SEM819","SEM814","SEME35","SEME58","SEME59","SEME57","SEME56","SEME61","SEME64","SEME66",
    "SEME65","SEME62","SEME60","SEME01","SEMD99","SEME70","SEME36","SEME63","SEME67","SEME71",
    "SEME69","SEME68","SEME72","SEME73","SEME78","SEME81","SEME79","SEME82","SEME95","SG8A37",
    "SG8A47","SG8A45","SG8A46","SG8B89","SG8A60","SEME75","SEME74","SG8A01","SG8A36","SG8A02",
    "SG8B91","SG8A38","XMB110D","XMB260T","XMR110D","XMR260T","ZBC","XMR120C","SG9E76","SG9E77",
    "XMB120C","ZBS","ZRC","ZBT","ZMT","ZMS"
])

def parse_float(s):
    if not s:
        return None
    try:
        return float(s)
    except:
        return None

def parse_int(s):
    if not s:
        return None
    try:
        return int(float(s))
    except:
        return None

def get_subtype(series_name, brand_name):
    s = (series_name + ' ' + brand_name).lower()
    if 'ball' in s or '볼' in s:
        return 'Ball'
    if 'radius' in s or '래디우스' in s:
        return 'Radius'
    if 'taper' in s or '테이퍼' in s:
        return 'Taper'
    if 'rough' in s or '라핑' in s or 'wave' in s:
        return 'Roughing'
    if 'chamfer' in s or '챔퍼' in s:
        return 'Chamfer'
    if 'drill' in s:
        return 'Drill'
    return 'Square'

def get_app_shapes(subtype):
    shapes = {
        'Ball': ['Profiling', 'Die-Sinking', '3D_Contouring'],
        'Radius': ['Side_Milling', 'Profiling', 'Die-Sinking', 'Slotting'],
        'Square': ['Side_Milling', 'Slotting', 'Profiling', 'Facing'],
        'Roughing': ['Side_Milling', 'Slotting', 'Heavy_Cutting'],
        'Taper': ['Die-Sinking', 'Profiling', 'Taper_Side_Milling'],
        'Chamfer': ['Chamfering'],
        'Drill': ['Drilling'],
    }
    return shapes.get(subtype, ['Side_Milling', 'Slotting'])

def resolve_material_tags(series_idx, series_mats):
    """Convert work material status to ISO groups"""
    mats = series_mats.get(series_idx, set())
    tags = []
    iso_map = {
        'P': ['steel', 'carbon', 'alloy', 'p_'],
        'M': ['stainless', 'm_'],
        'K': ['cast_iron', 'k_'],
        'N': ['aluminum', 'non_ferrous', 'n_', 'alu'],
        'S': ['super_alloy', 'titanium', 's_', 'inconel', 'heat'],
        'H': ['hardened', 'h_', 'hard'],
    }
    mat_str = ' '.join(mats).lower()
    for iso, keywords in iso_map.items():
        if any(kw in mat_str for kw in keywords):
            tags.append(iso)
    return tags

new_products = []
skipped_existing = 0
skipped_deleted = 0

for edp_no, raw in products_raw.items():
    # Skip if already exists
    code = edp_no.replace(' ', '')
    pid = f"db_{code}"
    if pid in existing_ids or code in existing_edps:
        skipped_existing += 1
        continue

    series = raw.get('series_name', '')
    brand = raw.get('brand_name', '')
    series_idx = raw.get('series_idx', '')

    # Get specs from main table
    diameter = parse_float(raw.get('option_od'))
    corner_r = raw.get('option_r', '')
    shank_d = parse_float(raw.get('option_sd'))
    loc = parse_float(raw.get('option_loc'))
    oal = parse_float(raw.get('option_oal'))
    flutes = parse_int(raw.get('option_flute'))
    z_count = parse_int(raw.get('option_z'))
    coating = raw.get('option_dc', '') or None
    tool_mat = raw.get('option_grade', '') or None
    helix = parse_float(raw.get('option_taperangle')) if raw.get('option_taperangle') else None
    coolant = raw.get('option_coolanthole', '')

    # Flute count: prefer option_z, fallback to option_flute
    flute_count = z_count or flutes

    # Get subtype
    subtype = get_subtype(series, brand)

    # Material tags
    mat_tags = resolve_material_tags(series_idx, series_materials)

    # Image
    icon_url = f"/images/series/{series}.jpg" if series in IMAGE_SERIES else None

    # Completeness
    filled = sum(1 for v in [diameter, oal, loc, shank_d, coating, tool_mat, flute_count] if v)
    completeness = round(filled / 7, 2)

    product = {
        "id": pid,
        "manufacturer": "YG-1",
        "brand": brand,
        "sourcePriority": 1,
        "sourceType": "product-db",
        "rawSourceFile": "merge_smart_catalog.xlsx",
        "rawSourceSheet": "prod_edp",
        "normalizedCode": code,
        "displayCode": code,
        "seriesName": series,
        "productName": f"{brand} {series} {code}",
        "toolType": "Solid",
        "toolSubtype": subtype,
        "diameterMm": diameter,
        "diameterInch": round(diameter / 25.4, 4) if diameter else None,
        "fluteCount": flute_count,
        "coating": coating,
        "toolMaterial": tool_mat,
        "shankDiameterMm": shank_d,
        "lengthOfCutMm": loc,
        "overallLengthMm": oal,
        "helixAngleDeg": helix,
        "ballRadiusMm": parse_float(corner_r.replace('R', '')) if corner_r and 'R' in corner_r else None,
        "taperAngleDeg": None,
        "coolantHole": True if coolant and coolant.upper() == 'Y' else None,
        "applicationShapes": get_app_shapes(subtype),
        "materialTags": mat_tags,
        "region": "GLOBAL",
        "description": f"{brand} {series}",
        "featureText": f"{brand} {series}",
        "seriesIconUrl": icon_url,
        "sourceConfidence": "high",
        "dataCompletenessScore": completeness,
        "evidenceRefs": [code],
    }
    new_products.append(product)

print(f"\n  New products from DB: {len(new_products)}")
print(f"  Skipped (already exist): {skipped_existing}")

# ── Step 5: Merge and save ──
print("\nStep 5: Merging...")
# Remove old catalog-pdf/csv dupes that DB now covers
# Keep existing, add new
all_products = existing + new_products
print(f"  Total products: {len(all_products)}")

# Save
with open(PRODUCTS_PATH, 'w', encoding='utf-8') as f:
    json.dump(all_products, f, ensure_ascii=False, indent=2)
print(f"  Saved to {PRODUCTS_PATH}")

# Summary
from collections import Counter
source_counts = Counter(p.get('sourceType', '') for p in all_products)
print("\nBy source:")
for k, v in source_counts.most_common():
    print(f"  {k}: {v}")

brand_counts = Counter(p.get('brand', '') for p in all_products)
print(f"\nBrands: {len(brand_counts)}")
for k, v in brand_counts.most_common(20):
    print(f"  {k}: {v}")
