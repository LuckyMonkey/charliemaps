import type { Neighborhood } from "../../types/models";

type Props = {
  items: Neighborhood[];
  value: string;
  onChange: (id: string) => void;
};

export function NeighborhoodSelect({ items, value, onChange }: Props) {
  return (
    <label className="control">
      Neighborhood
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
      </select>
    </label>
  );
}
