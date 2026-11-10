export type CommunityPostStatus = 'published' | 'hidden' | 'deleted';
export type CommunityPostScope = 'all' | 'mine';
export type CommunityPostSort = 'latest' | 'popular';
export type CommunityPostType = 'comment' | 'travel_journal';

export interface CommunityTravelJournal {
  id: string;
  title: string;
  opening: string;
  textSections: Array<{ id: string; title: string; body: string }>;
  conclusion: string;
  images: Array<{
    id: string;
    displayUrl: string;
    title: string;
    body: string;
    sortOrder: number;
  }>;
}

export interface CommunityPost {
  id: number;
  authorId: string;
  authorName: string;
  content: string;
  postType: CommunityPostType;
  travelJournal: CommunityTravelJournal | null;
  spot: {
    id: string;
    name: string;
  } | null;
  status: CommunityPostStatus;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityPostList {
  items: CommunityPost[];
  total: number;
  page: number;
  pageSize: number;
}
