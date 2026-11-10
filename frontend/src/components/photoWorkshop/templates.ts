export interface PhotoWorkshopTemplate {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  prompt: string;
}

export const PHOTO_WORKSHOP_TEMPLATES: PhotoWorkshopTemplate[] = [
  {
    id: 'anime',
    title: '二次元 / 动漫风',
    subtitle: '明快线稿与电影感光影',
    image: '/photo-workshop/templates/anime.png',
    prompt:
      '以参考图为构图与主体依据，将画面改编为精致的日系二次元动画风格。保留景点主体轮廓、空间关系和标志性细节，使用清晰细腻的线稿、层次丰富的赛璐璐上色、通透自然的色彩与电影感光影，让环境鲜活而富有旅行故事感；不要新增无关人物，不改变原有主体位置。',
  },
  {
    id: 'chibi',
    title: 'Q 版二次元',
    subtitle: '圆润可爱、轻松治愈',
    image: '/photo-workshop/templates/chibi.png',
    prompt:
      '以参考图为编辑对象，将景点转化为精致可爱的 Q 版二次元插画。保留原图的核心景观、构图方向和辨识度，把建筑、自然景物与细节适度圆润化、微缩化，使用柔和明亮的马卡龙色彩、细腻勾线和温暖光影，营造轻松治愈的旅行纪念感；不改变主要景物数量，不添加无关文字。',
  },
  {
    id: 'magazine',
    title: '时尚杂志风',
    subtitle: '高级排版与编辑质感',
    image: '/photo-workshop/templates/magazine.png',
    prompt:
      '以参考图中的灵山梵宫为视觉主体，创作高级旅行时尚杂志封面。保持建筑主体、透视关系与关键细节不变，优化光影、色彩和画面层次，使用克制留白、优雅网格排版与现代编辑质感；在不遮挡主体的位置加入清晰可读的中文标题“灵山梵宫”，字体呈现高端杂志风格，其余区域不要生成乱码或无意义文字。',
  },
  {
    id: 'season',
    title: '一键更换季节',
    subtitle: '冬日雪景与自然氛围',
    image: '/photo-workshop/templates/season.png',
    prompt:
      '以参考图为基础，把当前景区自然转换为宁静的冬季雪景。保持主体、构图、视角、建筑与道路位置完全不变，为地面、树梢和屋顶添加自然真实的积雪，空气中有轻盈细雪，使用清冷蓝白色调与柔和冬日光线；让新增雪景与原场景自然融合，避免遮挡标志性细节，不新增人物或文字。',
  },
];
