const CHAT_INPUT_ID = 'chat-input-field';
const CHAT_SEND_BUTTON_ID = 'chat-send-btn';

export function handleChatInputKeyboardFocus(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false;

  const chatInput = document.getElementById(CHAT_INPUT_ID) as HTMLInputElement | null;
  if (!chatInput) return false;

  if (document.activeElement === chatInput) {
    const sendButton = document.getElementById(CHAT_SEND_BUTTON_ID);
    if (sendButton) sendButton.click();
  } else {
    if (document.exitPointerLock) {
      document.exitPointerLock();
    }
    chatInput.focus();
    event.preventDefault();
    event.stopPropagation();
  }

  return true;
}

export function isTextInputElementActive(): boolean {
  return document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
}
