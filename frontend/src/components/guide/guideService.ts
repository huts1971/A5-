export type GuideServiceCategory =
  | 'restroom'
  | 'dining'
  | 'lodging'
  | 'shop'
  | 'shuttle';

export interface GuideServiceCategoryOption {
  id: GuideServiceCategory;
  label: string;
  description: string;
}

export const GUIDE_SERVICE_CATEGORIES: GuideServiceCategoryOption[] = [
  { id: 'restroom', label: '卫生间', description: '查看景区内卫生间位置' },
  { id: 'dining', label: '餐饮', description: '查看景区内餐饮点位' },
  { id: 'lodging', label: '住宿', description: '查看景区周边住宿位置' },
  { id: 'shop', label: '商铺', description: '查看景区内商铺位置' },
  { id: 'shuttle', label: '观光车站', description: '查看观光车站点位置' },
];

export function isGuideServiceCategory(value: string): value is GuideServiceCategory {
  return GUIDE_SERVICE_CATEGORIES.some((item) => item.id === value);
}
