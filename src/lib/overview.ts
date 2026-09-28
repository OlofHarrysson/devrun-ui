import type { ProjectState } from "../types/ui";

export function startTime(value?: string): number | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= Date.now() ? time : null;
}

export function projectTime(project: ProjectState, sort: "recent" | "longest"): number | null {
  const services = sort === "longest" ? project.services.filter((service) => service.running) : project.services;
  const times = services.map((service) => startTime(service.startedAt)).filter((time): time is number => time !== null);
  return times.length ? (sort === "longest" ? Math.min(...times) : Math.max(...times)) : null;
}

export function elapsed(time: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

export function projectHref(projectId: string, serviceName?: string): string {
  const query = new URLSearchParams({ project: projectId });
  if (serviceName) query.set("service", serviceName);
  return `/project?${query}`;
}
