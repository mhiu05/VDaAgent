'use client';

import { type Catalog } from '@vda/contracts';


export function ScopeFields({
  catalog,
  project,
  zone,
  setProject,
  setZone,
  disabled = false,
}: {
  catalog: Catalog;
  project: string;
  zone: string;
  setProject: (value: string) => void;
  setZone: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <label>
        Dự án
        <select
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setZone('');
          }}
          required
          disabled={disabled}
        >
          <option value="" disabled>
            Chọn dự án
          </option>
          {catalog.projects.map((item) => (
            <option key={item.project_external_id} value={item.project_external_id}>
              {item.project_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Phân khu
        <select value={zone} onChange={(event) => setZone(event.target.value)} disabled={disabled}>
          <option value="">Tất cả phân khu</option>
          {catalog.projects
            .find((item) => item.project_external_id === project)
            ?.zones.map((item) => (
              <option key={item.zone_external_id} value={item.zone_external_id}>
                {item.zone_name}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
