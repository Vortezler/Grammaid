/** Install the page bridge only in response to an explicit feature or an enabled site. */
export async function ensureContent(tabId: number): Promise<void> {
  await browser.tabs.executeScript(tabId, { file: 'content.js', allFrames: true, runAt: 'document_idle' });
}
