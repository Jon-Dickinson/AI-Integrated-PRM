import '@emotion/react';
import type { AppTheme } from './config';

declare module '@emotion/react' {
  export interface Theme extends AppTheme {}
}
