import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import '@fontsource/noto-serif-sc/900.css';
import './styles/global.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
