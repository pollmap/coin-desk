import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/stories/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  staticDirs: ['../public'],
};
export default config;
