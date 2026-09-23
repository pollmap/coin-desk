import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './style.css';
import './redesign.css';
import { saved } from './lib';
document.documentElement.dataset.theme =
  saved<string>('theme', 'dark') === 'light' ? 'light' : 'dark';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
