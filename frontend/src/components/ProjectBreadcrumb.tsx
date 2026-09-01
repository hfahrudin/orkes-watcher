import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/types'

const ENV_TAG: Record<Project['env'], string> = {
  production: 'tag tag-accent',
  staging: 'tag tag-neutral',
  local: 'tag tag-outline',
}

/**
 * Matches the mockup's two header variants: the dashboard puts the project name (+ env
 * tag) as the H4 with a bare "Projects /" crumb above it; every other project page puts
 * the project name in the crumb and a plain page title as the H4.
 */
export function ProjectBreadcrumb({ project, pageTitle }: { project: Project | undefined; pageTitle?: string }) {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'color-mix(in srgb, var(--color-text) 45%, transparent)' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: 0 }} onClick={() => navigate('/projects')}>
          Projects
        </button>
        <span>/</span>
        {pageTitle && project && <span className="mono">{project.name}</span>}
      </div>
      {pageTitle ? (
        <h4 style={{ margin: 0 }}>{pageTitle}</h4>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h4 className="mono" style={{ margin: 0 }}>{project?.name}</h4>
          {project && <span className={ENV_TAG[project.env]}>{project.env}</span>}
        </div>
      )}
    </div>
  )
}
