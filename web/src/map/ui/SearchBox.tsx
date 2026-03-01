type Props = {
  value: string;
  onChange: (next: string) => void;
};

export function SearchBox({ value, onChange }: Props) {
  return (
    <div className="ui-top">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search POI name..."
      />
    </div>
  );
}
