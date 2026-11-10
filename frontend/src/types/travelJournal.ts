export type TravelJournalStatus = 'draft' | 'published';

export interface TravelJournalTextSection {
  id: string;
  title: string;
  body: string;
}

export interface TravelJournalImage {
  id: string;
  displayUrl: string;
  sortOrder: number;
  title: string;
  body: string;
}

export interface TravelJournal {
  id: string;
  status: TravelJournalStatus;
  description: string;
  targetWords: number;
  title: string;
  opening: string;
  textSections: TravelJournalTextSection[];
  conclusion: string;
  images: TravelJournalImage[];
  createdAt: string;
  updatedAt: string;
}

export interface TravelJournalList {
  items: TravelJournal[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TravelJournalUploadResult {
  journal: TravelJournal;
  errors: Array<{
    filename: string;
    message: string;
    code: string;
  }>;
}
