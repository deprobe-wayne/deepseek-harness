// Old entries kept quantities in note; extract only an unambiguous, separated quantity suffix.
const quantitySuffix = /^(.*?)\s+(\d+(?:\.\d+)?\s*(?:公斤|千克|毫升|斤|克|吨|升|个|件|袋|包|箱|盒|瓶|支|只|把|张|份|条|根|桶|米|kg|ml|g|l)(?:\s*[×x*]\s*\d+(?:\.\d+)?\s*元\s*[/／]\s*(?:公斤|千克|毫升|斤|克|吨|升|个|件|袋|包|箱|盒|瓶|支|只|把|张|份|条|根|桶|米|kg|ml|g|l))?)$/iu;

/** Project a short item name and optional quantity/price details without changing stored legacy data.
 * @param item Ledger entry with note and optional details.
 * @returns Item text and details, preserving unmatched descriptions verbatim.
 */
export function entryDescription(item) {
    const note = item.note || '', details = item.details || '';
    if (details) return { note, details };
    const match = note.trim().match(quantitySuffix);
    return match?.[1] ? { note: match[1], details: match[2] } : { note, details };
}
