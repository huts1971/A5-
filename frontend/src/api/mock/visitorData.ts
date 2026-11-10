import type { ChatResponse, RoutePlan, ScenicSpot } from '../../types/scenic';

export const scenicSpots: ScenicSpot[] = [
  {
    id: 'yuanxiang-hall',
    name: '远香堂',
    subtitle: '荷风入堂，园林中轴的讲解核心',
    summary: '远香堂位于园林水面开阔处，是适合讲述空间布局、荷文化和古典园林审美的核心景点。',
    story:
      '远香堂的名字取自荷花清香远溢的意象。游客站在堂前，可以同时看到水面、亭榭和植物层次，适合用来理解江南园林“移步换景”的体验。',
    tags: ['历史', '建筑', '荷花', '讲解重点'],
    crowdTypes: ['亲子游', '历史文化游', '摄影游'],
    durationMinutes: 20,
    openInfo: '随景区开放时间参观，建议上午或傍晚停留。',
    serviceHint: '附近适合短暂停留拍照，团队讲解时注意避让主通道。',
    coverTone: 'water',
    imageUrl: '/scenic/spots/lake.svg',
    highlights: ['水面视野开阔', '适合拍摄亭榭倒影', '可讲述荷文化寓意'],
  },
  {
    id: 'xiaofeihong-bridge',
    name: '小飞虹',
    subtitle: '水上廊桥，连接游线的轻盈节点',
    summary: '小飞虹是园林中极具辨识度的廊桥景观，适合介绍空间连接、桥廊构造和游线节奏。',
    story:
      '小飞虹横跨水面，桥身轻巧，像一道低低的彩虹落在园中。它不只是通行设施，也是游客从水岸切换到另一段景观的过渡。',
    tags: ['建筑', '拍照', '水景'],
    crowdTypes: ['摄影游', '轻松游', '亲子游'],
    durationMinutes: 15,
    openInfo: '全天可经过，雨天注意桥面湿滑。',
    serviceHint: '桥面空间较窄，建议错峰拍照。',
    coverTone: 'culture',
    imageUrl: '/scenic/spots/bridge-water.svg',
    highlights: ['桥廊造型轻盈', '适合拍摄人物和水景', '连接多条游览动线'],
  },
  {
    id: 'lotus-wind-pavilion',
    name: '荷风四面亭',
    subtitle: '四面临风，适合休憩与故事化讲解',
    summary: '荷风四面亭靠近水面和植物景观，适合亲子游客休息，也适合讲述季节变化和园林借景。',
    story:
      '亭子四面通透，夏季可感受荷叶与水风带来的清凉。给孩子讲解时，可以从“为什么亭子要建在这里”切入。',
    tags: ['亲子', '休息', '自然', '荷花'],
    crowdTypes: ['亲子游', '轻松游'],
    durationMinutes: 15,
    openInfo: '建议游览中段停留，避开正午拥挤时段。',
    serviceHint: '附近适合短暂补水休息。',
    coverTone: 'garden',
    imageUrl: '/scenic/spots/garden-path.svg',
    highlights: ['四面观景', '亲子讲解友好', '适合中途休息'],
  },
  {
    id: 'bonsai-garden',
    name: '盆景园',
    subtitle: '微缩山水，展示园艺与审美细节',
    summary: '盆景园集中展示园林中的微观景观，适合文化游客了解匠心，也适合摄影游客寻找细节画面。',
    story:
      '盆景把山石、树木和空间缩入一方器物之中。它和大园林形成呼应：一个是可行可望的空间，一个是可近观的山水。',
    tags: ['园艺', '摄影', '文化'],
    crowdTypes: ['历史文化游', '摄影游'],
    durationMinutes: 25,
    openInfo: '室外区域按景区开放，部分展陈可能随季节调整。',
    serviceHint: '拍照时请勿触碰展品。',
    coverTone: 'garden',
    imageUrl: '/scenic/spots/flower-field.svg',
    highlights: ['细节丰富', '适合近景拍摄', '可讲述微缩山水'],
  },
  {
    id: 'visitor-service',
    name: '游客服务中心',
    subtitle: '咨询、休息、应急帮助的服务节点',
    summary: '游客服务中心提供咨询、路线建议和基础应急帮助，是路线推荐中重要的服务点。',
    story:
      '服务中心不是传统意义上的景点，但对真实导览体验很重要。AI 导游需要在游客迷路、疲劳或需要帮助时主动提示这里。',
    tags: ['服务', '休息', '咨询'],
    crowdTypes: ['亲子游', '轻松游'],
    durationMinutes: 10,
    openInfo: '通常与景区开放时间一致，具体以现场公告为准。',
    serviceHint: '可咨询洗手间、出口、失物招领和应急帮助。',
    coverTone: 'service',
    imageUrl: '/scenic/spots/service.svg',
    highlights: ['路线咨询', '短暂休息', '应急帮助'],
  },
];

export const routePlans: RoutePlan[] = [
  {
    id: 'mock-ling-shan-personalized',
    mapId: 'ling-shan',
    name: '灵山胜境个性化推荐路线',
    theme: '佛教文化、建筑艺术',
    durationMinutes: 115,
    suitableCrowd: [],
    description: '',
    reason: '',
    stayMinutes: 90,
    estimatedWalkMinutes: 25,
    timeDataComplete: true,
    generationMode: 'dynamic',
    pathComplete: false,
    routingProfile: 'fastest',
    timeEstimationStatus: 'map_estimate',
    spots: [
      { spotId: 'spot_ls_entrance', name: '景区入口', stayMinutes: 5, reason: '', transitionMinutes: 0 },
      { spotId: 'spot_ls_003', name: '佛足坛', stayMinutes: 15, reason: '', transitionMinutes: 11 },
      { spotId: 'spot_ls_004', name: '五智门', stayMinutes: 15, reason: '', transitionMinutes: 2 },
      { spotId: 'spot_nine_dragons', name: '九龙灌浴', stayMinutes: 20, reason: '', transitionMinutes: 5 },
      { spotId: 'spot_xiangfu_temple', name: '祥符禅寺', stayMinutes: 20, reason: '', transitionMinutes: 9 },
      { spotId: 'spot_ling_shan_buddha', name: '灵山大佛', stayMinutes: 30, reason: '', transitionMinutes: 9 },
    ],
  },
  {
    id: 'mock-nianhua-bay-personalized',
    mapId: 'nianhua-bay',
    name: '拈花湾个性化推荐路线',
    theme: '摄影打卡、自然休闲',
    durationMinutes: 105,
    suitableCrowd: [],
    description: '',
    reason: '',
    stayMinutes: 75,
    estimatedWalkMinutes: 30,
    timeDataComplete: true,
    generationMode: 'dynamic',
    pathComplete: false,
    routingProfile: 'fastest',
    timeEstimationStatus: 'map_estimate',
    spots: [
      { spotId: 'spot_nh_entrance', name: '景区入口', stayMinutes: 5, reason: '', transitionMinutes: 0 },
      { spotId: 'spot_nh_002', name: '梵天花海', stayMinutes: 20, reason: '', transitionMinutes: 21 },
      { spotId: 'spot_nh_003', name: '香月花街', stayMinutes: 20, reason: '', transitionMinutes: 4 },
      { spotId: 'spot_nh_001', name: '拈花广场', stayMinutes: 15, reason: '', transitionMinutes: 1 },
      { spotId: 'spot_nh_005', name: '五灯湖', stayMinutes: 20, reason: '', transitionMinutes: 6 },
    ],
  },
];

export const commonQuestions = [
  '灵山大佛有什么看点？',
  '梵宫有什么特色？',
  '带小朋友来适合先看哪里？',
  '哪里比较适合拍照？',
];

export const mockChatAnswers: Record<string, ChatResponse> = {
  route: {
    answer:
      '如果只有两个小时，建议走“历史文化精华线”：先到远香堂听园林布局和荷文化，再经过小飞虹感受桥廊与水面的关系，最后去盆景园看微缩山水。整条线停留约 90 到 110 分钟，节奏比较稳。',
    sources: [
      {
        id: 'src-route-culture',
        title: '历史文化精华线',
        spotName: '路线推荐资料',
        snippet: '路线优先选择可讲故事、可解释园林审美的节点，适合希望听深一点的游客。',
      },
    ],
  },
  yuanxiang: {
    answer:
      '远香堂适合从“荷文化”和“园林空间”两个角度理解。它位于水面开阔处，名字带有荷花清香远溢的意象。站在堂前可以看到水面、亭榭和植物层次，是讲解移步换景的好位置。',
    sources: [
      {
        id: 'src-yuanxiang',
        title: '远香堂景点资料',
        spotName: '远香堂',
        snippet: '远香堂位于园林水面开阔处，是适合讲述空间布局、荷文化和古典园林审美的核心景点。',
      },
    ],
  },
  family: {
    answer:
      '带小朋友建议先去荷风四面亭，用水面、荷叶和亭子的故事引起兴趣；再到远香堂讲“为什么园林一步一景”；中途可以到游客服务中心休息补水。这样讲解轻松，步行压力也低。',
    sources: [
      {
        id: 'src-family',
        title: '亲子轻松讲解线',
        spotName: '路线推荐资料',
        snippet: '减少折返和长距离步行，穿插休息点，用故事化方式讲园林。',
      },
    ],
  },
  photo: {
    answer:
      '拍照可以优先选择小飞虹、远香堂和盆景园。小飞虹适合拍人物与桥廊线条，远香堂适合拍水面和倒影，盆景园适合近景细节。建议避开人流高峰，照片会更干净。',
    sources: [
      {
        id: 'src-photo',
        title: '摄影取景线',
        spotName: '路线推荐资料',
        snippet: '覆盖远景、人物、倒影和近景细节，适合短时间产出高质量照片。',
      },
    ],
  },
  fallback: {
    answer:
      '当前资料里还没有找到这个问题的完整依据。我可以先根据已整理的景点资料，建议你从路线推荐页选择亲子、文化或摄影偏好，再进入对应景点查看讲解。',
    sources: [
      {
        id: 'src-fallback',
        title: '本地景点资料',
        spotName: '通用建议',
        snippet: '当前回答来自本地景点资料，适合用于基础路线和景点浏览建议。',
      },
    ],
  },
};
