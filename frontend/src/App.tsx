import { ConfigProvider } from 'antd';
import AdminApp from './apps/AdminApp';
import VisitorApp from './apps/VisitorApp';
import { getAppEntry } from './appEntry';
import { adminTheme, appTheme } from './styles/theme';

export default function App() {
  const appEntry = getAppEntry();
  const EntryApp = appEntry === 'admin' ? AdminApp : VisitorApp;

  return (
    <ConfigProvider theme={appEntry === 'admin' ? adminTheme : appTheme}>
      <EntryApp />
    </ConfigProvider>
  );
}
