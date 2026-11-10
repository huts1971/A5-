import type { ThemeConfig } from 'antd';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#d8dcc9',
    colorInfo: '#9aa696',
    colorSuccess: '#a8c2a2',
    colorWarning: '#d6b778',
    colorError: '#d78b7f',
    colorText: '#f3f0e8',
    colorTextSecondary: 'rgba(243, 240, 232, 0.66)',
    colorBgLayout: '#090a09',
    colorBgContainer: '#111310',
    colorBorder: 'rgba(216, 220, 201, 0.18)',
    borderRadius: 6,
    fontFamily:
      '"Avenir Next", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Button: {
      borderRadius: 4,
      controlHeight: 40,
    },
    Card: {
      borderRadiusLG: 4,
    },
    Layout: {
      headerBg: '#090a09',
      bodyBg: '#090a09',
    },
  },
};

export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2f6f63',
    colorInfo: '#2f6f63',
    colorSuccess: '#5a856a',
    colorWarning: '#c4834a',
    colorError: '#b85b44',
    colorText: '#141413',
    colorTextSecondary: '#5e5d59',
    colorTextTertiary: '#77746d',
    colorBgLayout: '#faf9f5',
    colorBgContainer: '#fefdfb',
    colorBgElevated: '#fefdfb',
    colorFillAlter: '#f5f4f0',
    colorBorder: 'rgba(20, 20, 19, 0.12)',
    colorBorderSecondary: 'rgba(20, 20, 19, 0.08)',
    borderRadius: 8,
    fontFamily:
      '"Microsoft YaHei", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Button: {
      borderRadius: 6,
      controlHeight: 40,
      primaryColor: '#fefdfb',
    },
    Card: {
      borderRadiusLG: 8,
    },
    Layout: {
      headerBg: '#fefdfb',
      bodyBg: '#faf9f5',
      siderBg: '#fefdfb',
    },
    Modal: {
      contentBg: '#fefdfb',
      headerBg: '#fefdfb',
      titleColor: '#141413',
    },
    Popover: {
      colorBgElevated: '#fefdfb',
    },
  },
};
