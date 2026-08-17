import { useMemo, useState } from 'react';
import { DocumentVault, MultiStepForm } from '../../../components/shared';
import type { SurveyRecord } from '../../surveys/types';
import type { DesignInput, EngineeringDesignRecord, EngineeringDocument } from '../types';
import { uploadEngineeringDocument } from '../services/engineeringStorage';

const field = 'mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]';

export function EngineeringDesignForm({ surveys, designers, initial, onSubmit, onCancel, loading }: {
  surveys: SurveyRecord[];
  designers: Array<{ id: string; name?: string; email?: string }>;
  initial?: EngineeringDesignRecord | null;
  onSubmit: (input: DesignInput) => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const [surveyId, setSurveyId] = useState(initial?.surveyId || '');
  const [designerId, setDesignerId] = useState(initial?.designerId || '');
  const [panelCount, setPanelCount] = useState(String(initial?.panelCount || ''));
  const [panelWattage, setPanelWattage] = useState(String(initial?.panelWattage || ''));
  const [inverterSpec, setInverterSpec] = useState(initial?.inverterSpec || '');
  const [systemCapacityKw, setSystemCapacityKw] = useState(String(initial?.systemCapacityKw || ''));
  const [documents, setDocuments] = useState<EngineeringDocument[]>(initial?.documents || []);
  const [error, setError] = useState('');
  const survey = surveys.find((record) => record.id === surveyId);
  const source = initial?.surveySnapshot || (survey ? {
    roofType: survey.roofType || '',
    roofAreaSqm: Number(survey.roofAreaSqm || 0),
    shadingNotes: survey.shadingNotes || '',
    structuralNotes: survey.structuralNotes || '',
    photos: survey.photos || [],
    capturedAt: survey.completedDate || '',
  } : undefined);
  const uploadKey = initial?.id || `draft-${surveyId || 'new'}`;
  const vaultDocs = (category: EngineeringDocument['category']) => documents.filter((document) => document.category === category).map((document) => ({ id: document.id, name: document.name, url: document.url, type: document.contentType, size: document.size, uploadedAt: document.uploadedAt }));
  const steps = useMemo(() => [
    { id: 'source', title: 'Survey & Assignment', description: 'Designs must originate from an approved survey.', content: <div className="space-y-3"><label className="block text-xs font-semibold">Approved survey<select className={field} value={surveyId} disabled={Boolean(initial)} onChange={(event) => setSurveyId(event.target.value)}><option value="">Select survey</option>{surveys.map((item) => <option key={item.id} value={item.id}>{item.surveyId} · {item.projectId}</option>)}</select></label><label className="block text-xs font-semibold">Designer<select className={field} value={designerId} onChange={(event) => setDesignerId(event.target.value)}><option value="">Assign engineer</option>{designers.map((designer) => <option key={designer.id} value={designer.id}>{designer.name || designer.email || designer.id}</option>)}</select></label>{source && <div className="rounded-xl bg-[var(--color-bg-sunken)] p-3 text-xs text-[var(--color-text-secondary)]"><p>Roof: {source.roofType || '—'} · {source.roofAreaSqm || '—'} m²</p><p className="mt-1">Shading: {source.shadingNotes || 'None recorded'}</p><p className="mt-1">Structural: {source.structuralNotes || 'None recorded'}</p><p className="mt-1">Survey photos transferred: {source.photos.length}</p></div>}</div> },
    { id: 'sizing', title: 'System Design', content: <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Panel count<input className={field} type="number" min="1" step="1" value={panelCount} onChange={(event) => setPanelCount(event.target.value)} /></label><label className="text-xs font-semibold">Panel wattage (W)<input className={field} type="number" min="1" value={panelWattage} onChange={(event) => setPanelWattage(event.target.value)} /></label><label className="text-xs font-semibold sm:col-span-2">Inverter specification<textarea className={field} rows={3} value={inverterSpec} onChange={(event) => setInverterSpec(event.target.value)} /></label><label className="text-xs font-semibold">System capacity (kW)<input className={field} type="number" min="0" step="0.01" value={systemCapacityKw} onChange={(event) => setSystemCapacityKw(event.target.value)} /></label></div> },
    { id: 'documents', title: 'Drawings', content: <div className="space-y-4"><DocumentVault title="Single-line diagram" description="Required before the design can be saved." accept="image/*,application/pdf" maxItems={1} documents={vaultDocs('single-line-diagram')} onUpload={async ([file]) => { if (!file) return; const document = await uploadEngineeringDocument(uploadKey, file, 'single-line-diagram'); setDocuments((current) => [...current.filter((item) => item.category !== 'single-line-diagram'), document]); }} /><DocumentVault title="Structural drawing" description="Optional structural design drawing." accept="image/*,application/pdf" maxItems={1} documents={vaultDocs('structural-drawing')} onUpload={async ([file]) => { if (!file) return; const document = await uploadEngineeringDocument(uploadKey, file, 'structural-drawing'); setDocuments((current) => [...current.filter((item) => item.category !== 'structural-drawing'), document]); }} /></div> },
  ], [designerId, designers, documents, initial, inverterSpec, panelCount, panelWattage, source, surveyId, surveys, systemCapacityKw, uploadKey]);

  return <div>{error && <p className="mb-3 rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">{error}</p>}<MultiStepForm steps={steps} title={initial ? `Revise ${initial.designId}` : 'Create engineering design'} submitLabel={initial ? 'Save revision' : 'Create draft'} loading={loading} onCancel={onCancel} onSubmit={() => { setError(''); const input = { surveyId, designerId, panelCount: Number(panelCount), panelWattage: Number(panelWattage), inverterSpec, systemCapacityKw: Number(systemCapacityKw), documents }; if (!surveyId || !designerId || !panelCount || !panelWattage || !inverterSpec.trim() || !systemCapacityKw || !documents.some((document) => document.category === 'single-line-diagram')) return setError('Complete all required design fields and upload a single-line diagram.'); onSubmit(input); }} /></div>;
}
