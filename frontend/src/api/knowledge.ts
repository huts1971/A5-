import { requestAdminFormData, requestAdminJson } from './adminClient';
import { USE_MOCK_API } from './config';
import type {
  KnowledgeDocItem,
  KnowledgeRebuildResult,
  OfficialWebFact,
  OfficialWebFactUpdate,
  WebFactCandidate,
  WebFactCandidateUpdate,
  WebFactCandidateStatus,
  WebFactReviewAction,
} from '../types/api';

const wait = (ms = 420) => new Promise((resolve) => window.setTimeout(resolve, ms));

interface BackendKnowledgeDoc {
  id: string;
  title: string;
  source_type: string;
  path: string;
  chunk_count: number;
  indexed: boolean;
}

function mapKnowledgeDoc(item: BackendKnowledgeDoc): KnowledgeDocItem {
  return {
    id: item.id,
    title: item.title,
    sourceType: item.source_type,
    path: item.path,
    chunkCount: item.chunk_count,
    indexed: item.indexed,
  };
}

export async function listKnowledgeDocs(): Promise<KnowledgeDocItem[]> {
  if (!USE_MOCK_API) {
    const response = await requestAdminJson<{
      items: BackendKnowledgeDoc[];
      total: number;
    }>('/api/knowledge/docs');
    return response.items.map(mapKnowledgeDoc);
  }

  await wait(180);
  return [
    {
      id: 'derived_doc_011',
      title: 'LS-011-灵山大佛',
      sourceType: 'md',
      path: 'v1/knowledge/docs/LS-011-灵山大佛.md',
      chunkCount: 1,
      indexed: true,
    },
    {
      id: 'doc_001',
      title: '灵山胜境 景点结构化数据集',
      sourceType: 'docx',
      path: 'Scenic Area Public Information Package/灵山胜境 景点结构化数据集.docx',
      chunkCount: 16,
      indexed: true,
    },
  ];
}

export async function uploadKnowledgeDoc(file: File): Promise<KnowledgeDocItem> {
  if (USE_MOCK_API) {
    await wait(180);
    return {
      id: `uploaded_${Date.now()}`,
      title: file.name.replace(/\.[^.]+$/, ''),
      sourceType: file.name.split('.').pop() || 'file',
      path: `data/knowledge_uploads/${file.name}`,
      chunkCount: 1,
      indexed: true,
    };
  }

  const formData = new FormData();
  formData.append('file', file);
  const response = await requestAdminFormData<BackendKnowledgeDoc>('/api/knowledge/docs', formData);
  return mapKnowledgeDoc(response);
}

export async function deleteKnowledgeDoc(docId: string): Promise<void> {
  if (USE_MOCK_API) {
    await wait(180);
    return;
  }

  await requestAdminJson(`/api/knowledge/docs/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
}

export async function rebuildKnowledgeIndex(): Promise<KnowledgeRebuildResult> {
  if (!USE_MOCK_API) {
    const response = await requestAdminJson<{
      status: string;
      doc_count: number;
      chunk_count: number;
    }>('/api/knowledge/rebuild', {
      method: 'POST',
    });
    return {
      status: response.status === 'rebuilt' ? 'completed' : 'running',
      message: '真实后端知识库索引已重建。',
      indexedDocs: response.doc_count,
      indexedChunks: response.chunk_count,
      startedAt: new Date().toISOString(),
    };
  }

  await wait();

  return {
    status: 'completed',
    message: '本地知识库索引已重建。',
    indexedDocs: 5,
    indexedChunks: 18,
    startedAt: new Date().toISOString(),
  };
}

interface BackendWebFactCandidate {
  id: number;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  fact_key: string;
  fact_value: string;
  source_url: string;
  source_level: string;
  question: string;
  answer_excerpt: string;
  status: WebFactCandidateStatus;
  created_at: string;
}

interface BackendOfficialWebFact {
  id: number;
  spot_id: string;
  spot_name: string;
  fact_key: string;
  fact_label: string;
  fact_value: string;
  source_url: string;
  source_type: string;
  updated_at: string;
}

function mapCandidate(item: BackendWebFactCandidate): WebFactCandidate {
  return {
    id: item.id,
    entityType: item.entity_type,
    entityId: item.entity_id,
    entityName: item.entity_name,
    factKey: item.fact_key,
    factValue: item.fact_value,
    sourceUrl: item.source_url,
    sourceLevel: item.source_level,
    question: item.question,
    answerExcerpt: item.answer_excerpt,
    status: item.status,
    createdAt: item.created_at,
  };
}

function mapOfficialFact(item: BackendOfficialWebFact): OfficialWebFact {
  return {
    id: item.id,
    spotId: item.spot_id,
    spotName: item.spot_name,
    factKey: item.fact_key,
    factLabel: item.fact_label,
    factValue: item.fact_value,
    sourceUrl: item.source_url,
    sourceType: item.source_type,
    updatedAt: item.updated_at,
  };
}

export async function listOfficialWebFacts(): Promise<OfficialWebFact[]> {
  if (USE_MOCK_API) {
    await wait(180);
    return [];
  }

  const response = await requestAdminJson<{
    items: BackendOfficialWebFact[];
    total: number;
  }>('/api/admin/web-facts');
  return response.items.map(mapOfficialFact);
}

export async function updateOfficialWebFact(
  factId: number,
  values: OfficialWebFactUpdate,
): Promise<OfficialWebFact> {
  const response = await requestAdminJson<BackendOfficialWebFact, {
    spot_id?: string;
    fact_key?: string;
    fact_value?: string;
    source_url?: string;
  }>(`/api/admin/web-facts/${factId}`, {
    method: 'PATCH',
    body: {
      spot_id: values.spotId,
      fact_key: values.factKey,
      fact_value: values.factValue,
      source_url: values.sourceUrl,
    },
  });
  return mapOfficialFact(response);
}

export async function deleteOfficialWebFact(factId: number): Promise<void> {
  await requestAdminJson(`/api/admin/web-facts/${factId}`, {
    method: 'DELETE',
  });
}

export async function listWebFactCandidates(status: WebFactCandidateStatus | '' = 'pending_review'): Promise<WebFactCandidate[]> {
  if (USE_MOCK_API) {
    await wait(180);
    return [];
  }

  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  const response = await requestAdminJson<{
    items: BackendWebFactCandidate[];
    total: number;
  }>(`/api/admin/web-fact-candidates${params.toString() ? `?${params.toString()}` : ''}`);
  return response.items.map(mapCandidate);
}

export async function reviewWebFactCandidate(
  candidateId: number,
  action: WebFactReviewAction,
): Promise<WebFactCandidate> {
  const response = await requestAdminJson<BackendWebFactCandidate, { action: WebFactReviewAction }>(
    `/api/admin/web-fact-candidates/${candidateId}/review`,
    {
      method: 'POST',
      body: { action },
    },
  );
  return mapCandidate(response);
}

export async function updateWebFactCandidate(
  candidateId: number,
  values: WebFactCandidateUpdate,
): Promise<WebFactCandidate> {
  const response = await requestAdminJson<BackendWebFactCandidate, {
    entity_type?: string;
    entity_id?: string;
    entity_name?: string;
    fact_key?: string;
    fact_value?: string;
    source_url?: string;
    source_level?: string;
    question?: string;
    answer_excerpt?: string;
  }>(
    `/api/admin/web-fact-candidates/${candidateId}`,
    {
      method: 'PATCH',
      body: {
        entity_type: values.entityType,
        entity_id: values.entityId,
        entity_name: values.entityName,
        fact_key: values.factKey,
        fact_value: values.factValue,
        source_url: values.sourceUrl,
        source_level: values.sourceLevel,
        question: values.question,
        answer_excerpt: values.answerExcerpt,
      },
    },
  );
  return mapCandidate(response);
}
