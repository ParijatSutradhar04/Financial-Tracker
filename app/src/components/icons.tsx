import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { Account } from '../api';

export function CloseIcon({ size = 16, color = '#8e8e93' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M4 4l8 8M12 4l-8 8" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

export function PlusIcon({ size = 14, color = '#ffffff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path d="M7 2v10M2 7h10" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function SalaryUpArrowIcon({ size = 13, color = '#30d158' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <Path d="M6.5 1v11M3 4.5l3.5-3.5 3.5 3.5" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 13, color = '#48484a' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <Path d="M1 6.5h11M7 2l4.5 4.5L7 11" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function BigArrowRightIcon({ size = 24, color = '#5b5cf6' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ClockIcon({ size = 10, color = '#5b5cf6' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <Circle cx={5} cy={5} r={4} stroke={color} strokeWidth={1.2} />
      <Path d="M5 3v2l1.5 1" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 12, color = '#8e8e93' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M2.5 4.5L6 8l3.5-3.5" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function EyeIcon({ open, size = 17, color = '#8e8e93' }: { open: boolean; size?: number; color?: string }) {
  if (open) {
    return (
      <Svg width={size} height={size} viewBox="0 0 17 17" fill="none">
        <Path d="M1 8.5C1 8.5 3.5 4 8.5 4s7.5 4.5 7.5 4.5S13.5 13 8.5 13 1 8.5 1 8.5z" stroke={color} strokeWidth={1.3} />
        <Circle cx={8.5} cy={8.5} r={2} stroke={color} strokeWidth={1.3} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 17 17" fill="none">
      <Path
        d="M2 2l13 13M6.5 5.2C7 5 7.7 4.8 8.5 4.8c5 0 7.5 4.5 7.5 4.5s-.7 1.3-2 2.5M4.5 6.5C2.7 7.8 1 10.3 1 10.3S3.5 15 8.5 15c1.2 0 2.2-.2 3.1-.6"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const ROLE_ACCENTS = { primary: '#5b5cf6', salary: '#30d158', none: '#48484a' } as const;

export function accentFor(role: Account['role']): string {
  return ROLE_ACCENTS[role ?? 'none'];
}

export function AccountIcon({ role, color, size = 18 }: { role: Account['role']; color: string; size?: number }) {
  if (role === 'salary') {
    return (
      <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
        <Path d="M9 2v14M5 6l4-4 4 4" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M4 13h10" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Rect x={1} y={4} width={16} height={10} rx={2} stroke={color} strokeWidth={1.5} />
      <Path d="M1 8h16" stroke={color} strokeWidth={1.5} />
      <Rect x={4} y={11} width={3} height={1.5} rx={0.75} fill={color} />
    </Svg>
  );
}

export function CreditCardIcon({ size = 18, color = '#ff9f0a' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Rect x={1} y={3.5} width={16} height={11} rx={2} stroke={color} strokeWidth={1.5} />
      <Path d="M1 7.5h16" stroke={color} strokeWidth={1.5} />
      <Rect x={3.5} y={10.5} width={4} height={1.5} rx={0.75} fill={color} />
    </Svg>
  );
}

export function EditIcon({ size = 13, color = '#8e8e93' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M9.5 1.5l3 3-7 7-3.5 1 1-3.5 7-7z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TrashIcon({ size = 13, color = '#ff3b30' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path d="M2 3.5h10M5.5 3.5V2h3v1.5" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M3 3.5l.6 8.5a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-8.5" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.6 6v4M8.4 6v4" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    </Svg>
  );
}

export function EmptyBoxIcon({ size = 32, color = '#8e8e93' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Rect x={4} y={8} width={24} height={16} rx={3} stroke={color} strokeWidth={1.5} />
      <Path d="M4 13h24" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}
