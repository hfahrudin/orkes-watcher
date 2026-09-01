-- Orkes Watcher — full schema DDL for bootstrapping a brand-new Postgres instance.
--
-- Generated via `pg_dump --schema-only` against the schema produced by Alembic's
-- migration history (alembic/versions/) — this is a snapshot, not a hand-maintained
-- source of truth. If the models under app/models/ change, regenerate this file rather
-- than hand-editing it:
--
--   docker compose exec postgres pg_dump -U orkes -d orkes --schema-only \
--     --no-owner --no-privileges > backend/ddl.sql
--
-- Usage: run this against an empty database to get the full schema in one shot, without
-- replaying migration history — e.g. `psql -U orkes -d orkes -f ddl.sql`.
--
-- If you intend to keep using Alembic afterward (recommended), stamp its version table so
-- future `alembic upgrade head` calls don't try to recreate tables that already exist:
--
--   uv run alembic stamp head   # as of this file, head is 2e1c817b7e6a

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: api_key_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.api_key_scope AS ENUM (
    'ingest',
    'read',
    'revoked'
);


--
-- Name: project_env; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_env AS ENUM (
    'production',
    'staging',
    'local'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'admin',
    'developer',
    'viewer'
);


--
-- Name: run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.run_status AS ENUM (
    'running',
    'finished',
    'failed'
);


--
-- Name: session_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_kind AS ENUM (
    'browser',
    'cli'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'active',
    'invited'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    label character varying NOT NULL,
    prefix character varying NOT NULL,
    secret_hash character varying NOT NULL,
    scope public.api_key_scope NOT NULL,
    created_by uuid NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: node_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_stats (
    project_id uuid NOT NULL,
    node_id character varying NOT NULL,
    node_name character varying NOT NULL,
    run_count bigint NOT NULL,
    visit_count bigint NOT NULL,
    total_duration_us bigint NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    user_id uuid NOT NULL,
    project_id uuid NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid NOT NULL,
    name character varying NOT NULL,
    env public.project_env NOT NULL,
    retention_days integer NOT NULL,
    sampling_pct smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    graph_name character varying NOT NULL,
    status public.run_status NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    node_count integer NOT NULL,
    edge_count integer NOT NULL,
    loop_count integer NOT NULL,
    elapsed_us bigint,
    error text
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id character varying NOT NULL,
    user_id uuid NOT NULL,
    kind public.session_kind NOT NULL,
    device_label character varying NOT NULL,
    ip character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying NOT NULL,
    name character varying NOT NULL,
    password_hash character varying NOT NULL,
    role public.role NOT NULL,
    status public.user_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: node_stats node_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_stats
    ADD CONSTRAINT node_stats_pkey PRIMARY KEY (project_id, node_id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (user_id, project_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_api_keys_prefix ON public.api_keys USING btree (prefix);


--
-- Name: ix_api_keys_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_api_keys_project_id ON public.api_keys USING btree (project_id);


--
-- Name: ix_runs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_runs_project_id ON public.runs USING btree (project_id);


--
-- Name: ix_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_user_id ON public.sessions USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: api_keys api_keys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: api_keys api_keys_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: node_stats node_stats_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_stats
    ADD CONSTRAINT node_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: runs runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


