export function voiceAvailable() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function captureSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return Promise.reject(new Error('Voice input is unavailable in this browser.'));
  return new Promise((resolve, reject) => {
    const recognition = new Recognition();
    recognition.lang = document.documentElement.lang || 'en';
    recognition.onresult = event => resolve(event.results[0][0].transcript);
    recognition.onerror = () => reject(new Error('Voice input couldn’t start or hear a request. Try typing instead.'));
    recognition.onend = () => reject(new Error('No speech was detected. Try again or type your request.'));
    recognition.start();
  });
}

export function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}
