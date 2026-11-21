import '@testing-library/jest-dom/vitest';

// jsdom has no `matchMedia`, and modules such as `windowEnvironment` read it when they are imported
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: undefined,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
