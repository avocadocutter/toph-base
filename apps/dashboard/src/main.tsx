import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app';
import './stores/ui-store'; // side-effect: hydrates theme, registers OS preference listener
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
