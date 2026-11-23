async function enableSidePanelOnActionClick(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to configure side panel behavior:', error);
  }
}

void enableSidePanelOnActionClick();

chrome.runtime.onInstalled.addListener(() => {
  void enableSidePanelOnActionClick();
});
