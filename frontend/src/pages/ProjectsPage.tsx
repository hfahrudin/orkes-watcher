import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { RoleGate } from '../components/RoleGate'
import { ErrorState } from '../components/ErrorState'
import type { Project } from '../lib/types'

const ENV_TAG: Record<Project['env'], string> = {
  production: 'tag tag-accent',
  staging: 'tag tag-neutral',
  local: 'tag tag-outline',
}

const ENV_DESC: Record<Project['env'], string> = {
  production: 'Live traffic. Traces here are what customers are actually running.',
  staging: 'Pre-production traffic for verifying a graph change before it ships.',
  local: 'Scratch project for SDK experiments.',
}

interface Stats {
  runs: number
  keys: number
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [env, setEnv] = useState<Project['env']>('production')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const navigate = useNavigate()

  function load() {
    setLoadError(null)
    api
      .listProjects()
      .then(async (list) => {
        setProjects(list)
        const entries = await Promise.all(
          list.map(async (p) => {
            const [runs, keys] = await Promise.all([api.listRuns(p.id), api.listApiKeys(p.id)])
            return [p.id, { runs: runs.length, keys: keys.length }] as const
          }),
        )
        setStats(Object.fromEntries(entries))
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load projects'))
  }

  useEffect(() => {
    load()
  }, [])

  async function createProject() {
    if (!name.trim()) return
    setCreateError(null)
    try {
      const project = await api.createProject({ name: name.trim(), env })
      setProjects((p) => [...(p ?? []), project])
      setCreating(false)
      setName('')
      navigate(`/${project.id}/dashboard`)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create project')
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={load} />
  if (!projects) return <p className="text-muted">Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h4 style={{ margin: 0 }}>Projects</h4>
          <span style={{ fontSize: 12.5, color: 'var(--c-text2)' }}>Pick a project to open its dashboard and trace log.</span>
        </div>
        <RoleGate roles={['admin']}>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
            <i className="ph ph-plus" />
            New project
          </button>
        </RoleGate>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
        {projects.map((p) => {
          const s = stats[p.id]
          return (
            <button key={p.id} className="pcard" onClick={() => navigate(`/${p.id}/dashboard`)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 15 }}>{p.name}</span>
                <span className={ENV_TAG[p.env]} style={{ marginLeft: 'auto' }}>{p.env}</span>
              </div>
              <span style={{ fontSize: 12.5, color: 'color-mix(in srgb, var(--c-text) 58%, transparent)' }}>{ENV_DESC[p.env]}</span>
              {s && (
                <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 50%, transparent)', paddingTop: 2 }}>
                  <span>{s.runs} runs</span>
                  <span>{s.keys} keys</span>
                  <span>retention {p.retentionDays}d</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-accent)' }} />
                <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--c-text) 55%, transparent)' }}>healthy</span>
                <i className="ph ph-arrow-right" style={{ marginLeft: 'auto', color: 'var(--color-neutral-600)' }} />
              </div>
            </button>
          )
        })}

        <RoleGate roles={['admin']}>
          <button
            className="pcard"
            onClick={() => setCreating(true)}
            style={{ alignItems: 'flex-start', justifyContent: 'center', gap: 6, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--color-divider)', minHeight: 148 }}
          >
            <i className="ph ph-plus" style={{ fontSize: 18, color: 'var(--color-accent)' }} />
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>New project</span>
            <span style={{ fontSize: 12, color: 'color-mix(in srgb, var(--c-text) 50%, transparent)' }}>
              Creates an ingest namespace and its first API key.
            </span>
          </button>
        </RoleGate>
      </div>

      {creating && (
        <div className="dialog-backdrop" onClick={() => setCreating(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">New project</div>
            <div className="dialog-body">A project is one ingest namespace. Its first API key is generated on create.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label>Name</label>
                <input className="input" placeholder="support-triage" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>Environment</label>
                <div className="seg">
                  {(['production', 'staging', 'local'] as const).map((e) => (
                    <label className="seg-opt" key={e}>
                      <input type="radio" name="new-project-env" checked={env === e} onChange={() => setEnv(e)} />
                      {e[0].toUpperCase() + e.slice(1)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {createError && <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{createError}</p>}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={createProject}>
                Create project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
