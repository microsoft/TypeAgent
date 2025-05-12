// test/serviceWorker/ui.test.ts
import { showBadgeError, showBadgeHealthy, showBadgeBusy } from '../../src/extension/serviceWorker/ui';

describe('UI Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('showBadgeError', () => {
    it('should set badge background color to red and text to "!"', () => {
      showBadgeError();
      
      // The implementation in your ui.ts uses callback functions for these Chrome API calls
      // Let's check that they are called with the right parameters
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
        { color: "#F00" }, 
        expect.any(Function)
      );
      
      // Find the callback function that was passed
      const callback = (chrome.action.setBadgeBackgroundColor as jest.Mock).mock.calls[0][1];
      
      // Call the callback to simulate completion
      if (callback) callback();
      
      // Now check that setBadgeText was called
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
    });
  });
  
  describe('showBadgeHealthy', () => {
    it('should clear the badge text', () => {
      showBadgeHealthy();
      
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
        text: "",
      });
    });
  });
  
  describe('showBadgeBusy', () => {
    it('should set badge background color to blue and text to "..."', () => {
      showBadgeBusy();
      
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
        { color: "#0000FF" }, 
        expect.any(Function)
      );
      
      // Find the callback function that was passed
      const callback = (chrome.action.setBadgeBackgroundColor as jest.Mock).mock.calls[0][1];
      
      // Call the callback to simulate completion
      if (callback) callback();
      
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "..." });
    });
  });
});