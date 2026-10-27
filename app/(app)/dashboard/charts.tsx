"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Charts for the dashboard. Colours follow the design tokens: blue for recovered, slate for expired.
// Each chart has a visually hidden table so screen-reader users get the same numbers.

const BLUE = "#2563eb";
const SLATE = "#94a3b8";
const AXIS = "#64748b";

export type TrendPoint = { label: string; recovered: number; expired: number };
export type ProcedureBar = { label: string; recovered: number };

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <figure>
      <div className="h-64 w-full" role="img" aria-label="Recovered and expired slots over time">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "#f1f5f9" }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="recovered" name="Recovered" fill={BLUE} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="expired" name="Expired" fill={SLATE} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Recovered and expired slots over time</caption>
        <thead>
          <tr><th scope="col">Date</th><th scope="col">Recovered</th><th scope="col">Expired</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{d.label}</th><td>{d.recovered}</td><td>{d.expired}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function ProcedureChart({ data }: { data: ProcedureBar[] }) {
  const height = Math.max(120, data.length * 40 + 24);
  return (
    <figure>
      <div className="w-full" style={{ height }} role="img" aria-label="Recovered slots by treatment">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={96} tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "#f1f5f9" }} />
            <Bar dataKey="recovered" name="Recovered" fill={BLUE} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Recovered slots by treatment</caption>
        <thead>
          <tr><th scope="col">Treatment</th><th scope="col">Recovered</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{d.label}</th><td>{d.recovered}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
