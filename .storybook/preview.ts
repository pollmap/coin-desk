import '../src/style.css';
import '../src/product-desk.css';
import '../src/indicator-workspace.css';
import type { Preview } from '@storybook/react-vite';
const preview: Preview = {
  globalTypes: { theme: { description: '화면 테마', toolbar: { items: ['light', 'dark'] } } },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) => {
      document.documentElement.dataset.theme = context.globals.theme;
      return Story();
    },
  ],
  parameters: { a11y: { test: 'error' }, layout: 'padded' },
};
export default preview;
