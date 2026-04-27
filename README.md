# Disavow File Builder

Small client-side tool for SEOs who need to turn backlink exports into a Google Disavow-ready text file.

## What it does

- Accepts Excel files (`.xlsx`, `.xls`, `.xlsm`), `.csv`, `.tsv`, `.txt`, or pasted rows
- Detects common backlink or referring-domain columns from SEO exports
- Auto-selects the most likely workbook tab and lets you switch sheets manually
- Converts rows into `domain:example.com` or exact URL entries
- Removes duplicates
- Downloads a clean `disavow.txt` file

## How to use

1. Open [index.html](C:\Users\awais\Documents\Codex\2026-04-26\now-we-have-to-create-a\index.html).
2. Upload your export or paste the rows.
3. If it is an Excel workbook, confirm the selected sheet.
4. Check the detected source column and output mode.
5. Download the generated text file.

## Notes

- `Disavow by domain` is the safest default when your export contains full backlink URLs.
- The tool strips leading `www.` by default, but keeps other subdomains unchanged.
- Excel parsing uses a browser-loaded SheetJS script, so the page needs internet access the first time it loads that library.
- For multi-tab workbooks, the tool scores each sheet and opens the most likely backlink tab first.
- Review the final output before uploading it in Google Search Console.
