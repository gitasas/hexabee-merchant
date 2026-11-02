#!/usr/bin/env python3
"""
Builds scripts/fixtures/invoice-import.xlsx, the file `npm run verify:invoice-import`
reads.

    python3 scripts/fixtures/make-invoice-import-fixture.py

Why a fixture at all: the sheet this was written against is a real merchant's,
holds 53 families' names and addresses, and lives on one laptop. A check that
only runs where that file happens to be is a check nobody else can run - and it
would also put children's names in a public repository.

So the fixture is not a toy. Every row below reproduces a shape found in the
real file, and the awkward ones are the point:

  row 4   the unit rates, ABOVE the header - anything that guessed where the
          header was would read these as a pupil
  row 5   the header
  row 6   blank, between the header and the data
  row 10  a hand override: 21 lunches at 4,80 written as 54,60 in the amount
          column, so the lines do not sum to the merchant's own total. This is
          Leonas Bunikis, and it is the row that proves rule 2 earns its place
  row 11  float noise - 109.20000000000002, exactly as the real file stores it,
          plus a second "Kita" value: one lone number in a column is not a
          pattern the suggester may act on
  row 12  no email address
  row 13  blank, in the middle of the data
  row 14  settles to nothing: a credit cancelling the charges
  row 15  a total written as a FORMULA with no cached value, which is
          unreadable rather than empty
  row 18+ a column total and a price list, with no name on them - the shape
          that must be set aside rather than refused

⚠️ openpyxl writes a formula without a cached result, which is precisely the
case `uncachedFormulas` exists to count. That is deliberate here, not a
limitation of the generator.
"""
import pathlib

from openpyxl import Workbook

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "invoice-import.xlsx"

wb = Workbook()
ws = wb.active
ws.title = "2026m. rugsėjo mėn."

ws["F1"] = "Mokinių pietūs, pavakariai ir kiti mokesčiai 2026 m. rugsėjo mėn"

# The rates, above the header, exactly where the real file keeps them.
ws["H4"], ws["I4"], ws["J4"] = 4.8, 3, 2.6

header = [
    None, "Vardas, pavardė", "Klasė", "Tėveliai", "Tėvelių el paštas",
    "Pietūs ir pavakariai vnt ", "Tik pietūs vnt.", "Pietūs 4.80  Eur.",
    "Pavakariai 3 Eur.", "Taikoma nuolaida -2,6 Eur", "Kita",
    "Iš viso už maistą", "Užimtumas po pamokų", "Iš viso mokėti", "Komentarai",
]
for i, v in enumerate(header, start=1):
    ws.cell(row=5, column=i, value=v)

# row 6 stays blank

def row(r, n, pupil, klase, parent, email, both, lunch_only,
        lunch, snack, disc, other, food, act, total, comment=None):
    vals = [n, pupil, klase, parent, email, both, lunch_only, lunch, snack,
            disc, other, food, act, total, comment]
    for i, v in enumerate(vals, start=1):
        if v is not None:
            ws.cell(row=r, column=i, value=v)

# Ordinary row: 21 x 4,80 + 21 x 3,00 - 54,60 + 10,00 = 119,20
row(7, 1, "Augustas Červonikovas", "1VDL", "Gintarė Sakalauskė", "gintareskl@example.com",
    21, None, 100.8, 63, 54.6, None, 109.2, 10, 119.2)

# Two children, one parent - two invoices, deliberately not merged.
row(8, 2, "Lilija Červonikovaitė", "4", "Gintarė Sakalauskė", "gintareskl@example.com",
    21, None, 100.8, 63, None, None, 163.8, 10, 173.8)

# "Kita" with its description in the comments column.
row(9, 3, "Emma Karlė", "2", "Romantė Karlienė", "romante@example.com",
    21, None, 100.8, 63, 54.6, 50, 109.2, None, 159.2,
    "2 papildomos pamokos po 25 eur.")

# ⚠️ The hand override. 21 lunches would be 100,80; 54,60 is typed in. The
# lines then give 0,00 + 30,00 = 30,00 against a stated 30,00, so this row is
# CONSISTENT - which is the real finding: the amounts are authoritative and the
# quantities are not. The refusal case is the next row.
row(10, 4, "Leonas Bunikis", "1VDL", "Gintarė Bunikienė", "gintarebun@example.com",
    None, 21, 54.6, 0, 54.6, None, 0, 30, 30)

# Float noise, exactly as the real file stores it.
row(11, 5, "Rea Ana Nissen", "1VDL", "Rūta Nissen", "ruta@example.com",
    21, None, 100.8, 63, 54.6, 25, 109.20000000000002, None, 134.20000000000002,
    "1 papildoma pamoka")

# No email and no phone - refused, never guessed.
row(12, 6, "Viltė Sipavičiūtė", "8", "Nerijus Sipavičius", None,
    None, None, 50, None, None, None, 50, None, 50)

# row 13 blank, in the middle of the data

# Settles to nothing: the credit cancels the charges. Sent, with no pay link.
row(14, 7, "Matas Ivanauskas", "3", "Gabrielė Ivanauskienė", "gabriele@example.com",
    None, None, 100, None, 100, None, 0, None, 0)

# ⚠️ The stated total is a formula with no cached value: unreadable, not empty.
row(15, 8, "Jonas Druktenis", "1VDL", "Viktorija Druktenienė", "viktorija@example.com",
    21, None, 100.8, 63, None, None, 163.8, None, None)
ws["N15"] = "=H15+I15+M15"

# A row whose lines genuinely disagree with the merchant's own total: 100,80
# charged, 90,00 claimed. Refused and listed.
row(16, 9, "Paulina Balčiūtė", "2", "Ieva Balčienė", "ieva@example.com",
    21, None, 100.8, None, None, None, 100.8, None, 90)

# ⚠️ Below the data their real sheet carries a column total and an eight-line
# price list. Read as pupils those produced eight refusals - pure noise in the
# one list that has to stay readable. Two of those rows here: no name on
# either, so both are set aside into `ignored` rather than refused.
ws["M18"] = 557
ws["M19"] = "BLIC 88 potyrių ir tobulėjimo studija:"
ws["M20"] = "MAX - 90 Eur/mėn"

wb.create_sheet("Lapas1")
wb.save(OUT)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
