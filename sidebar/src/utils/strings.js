export const ACTION_TEMPLATES = {
  ask: (text) => `Answer clearly:\n\n${text}`,
  summarize: (text) => `Summarize this content in bullet points:\n\n${text}`,
  translate: (text) => `Translate this to Vietnamese:\n\n${text}`,
  rewrite: (text) => `Rewrite for clarity and grammar:\n\n${text}`,
  explain: (text) => `Explain the code below in simple terms:\n\n${text}`,
};
