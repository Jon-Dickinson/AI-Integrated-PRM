import { createRoot } from 'react-dom/client';
import { ThemeProvider, Global, css } from '@emotion/react';
import App from './App';
import { theme, type AppTheme } from './config';

const globalStyles = (t: AppTheme) => css`
  * {
    box-sizing: border-box;
  }
  html,
  body,
  #root {
    margin: 0;
    padding: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-family: ${t.font};
    background: ${t.bg};
    color: ${t.text};
    user-select: none;
  }
`;

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <Global styles={globalStyles} />
    <App />
  </ThemeProvider>
);
