import { useEffect, useRef } from 'react';
import styled from '@emotion/styled';
import { useTheme } from '@emotion/react';
import { colors, sim } from './config';
import { capacity, type GameState } from './engine';

const Box = styled.div`
  position: relative;
  width: ${(p) => p.theme.container.cell * sim.cols + 4}px;
  border: 2px solid ${(p) => p.theme.container.border};
  background: rgba(2, 8, 25, 0.6);
  border-radius: 4px;
  overflow: visible;
`;

const ContainerCanvas = styled.canvas`
  display: block;
`;

// Ruler: 0% at the bottom of the container, 100% at the top.
// Ticks every 5%, longer marks every 10%.
const Ruler = styled('div', {
  shouldForwardProp: (prop) => prop !== 'heightPx',
})<{ heightPx: number }>`
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 4px;
  width: 70px;
  height: ${(p) => p.heightPx}px;
  border-left: 1px solid ${(p) => p.theme.line};
`;

const Tick = styled('span', {
  shouldForwardProp: (prop) => !['major', 'bottomPct'].includes(prop),
})<{ major: boolean; bottomPct: number }>`
  position: absolute;
  left: 0;
  bottom: ${(p) => p.bottomPct}%;
  width: ${(p) => (p.major ? 14 : 8)}px;
  border-top: 1px solid ${(p) => p.theme.line};
`;

// Gauge sits on the top edge of the highest row of blocks
// and shows the nearest whole percentage.
const Gauge = styled('div', {
  shouldForwardProp: (prop) => prop !== 'bottomPx',
})<{ bottomPx: number }>`
  position: absolute;
  left: 0;
  bottom: ${(p) => p.bottomPx}px;
  width: 22px;
  border-top: 2px solid #fff;
  transition: bottom 0.15s linear;
`;

const GaugeLabel = styled.span`
  position: absolute;
  left: 28px;
  top: -10px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  color: #fff;
`;

const Fail = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(2, 8, 25, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 14px;
  padding: 16px;
  z-index: 10;
  border-radius: 4px;
`;

const FailTitle = styled.b`
  font-size: 20px;
  color: #ff5c5c;
`;

const FailText = styled.span`
  font-size: 14px;
  color: #cfd8ee;
  line-height: 1.5;
`;

const FailButton = styled.button`
  padding: 10px 20px;
  border: 0;
  border-radius: 6px;
  background: #f5a623;
  color: #030c2b;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.1s;
  &:hover {
    opacity: 0.9;
    transform: scale(1.02);
  }
`;

interface Props {
  state: GameState;
  onReset: () => void;
  label: string;
}

export default function ContainerView({ state, onReset, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    container: { cell, dot },
  } = useTheme();
  const canvasHeight = cell * sim.rows;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, cell * sim.cols, canvasHeight);

    state.fill.forEach((colorIndex, itemIndex) => {
      const column = itemIndex % sim.cols;
      const row = Math.floor(itemIndex / sim.cols);

      context.fillStyle = colors[colorIndex].light;
      context.fillRect(
        column * cell + (cell - dot) / 2,
        canvasHeight - (row + 1) * cell + (cell - dot) / 2,
        dot,
        dot,
      );
    });
  });

  const fillPercent = Math.round((state.fill.length / capacity) * 100);
  const occupiedRows = Math.ceil(state.fill.length / sim.cols);

  return (
    <Box>
      <ContainerCanvas
        ref={canvasRef}
        width={cell * sim.cols}
        height={canvasHeight}
      />
      <Ruler heightPx={canvasHeight}>
        {Array.from({ length: 21 }, (_, tickIndex) => (
          <Tick
            key={tickIndex}
            major={tickIndex % 2 === 0}
            bottomPct={tickIndex * 5}
          />
        ))}
        <Gauge bottomPx={Math.max(0, occupiedRows * cell - 1)}>
          <GaugeLabel>{fillPercent}%</GaugeLabel>
        </Gauge>
      </Ruler>
      {state.failed && (
        <Fail>
          <FailTitle>Container Full!</FailTitle>
          <FailText>
            The simulation overflowed after {Math.floor(state.t)} seconds.
            <br />
            {label}
          </FailText>
          <FailButton type="button" onClick={onReset}>
            Restart Simulation
          </FailButton>
        </Fail>
      )}
    </Box>
  );
}