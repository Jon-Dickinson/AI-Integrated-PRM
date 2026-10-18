import styled from '@emotion/styled';
import { keyframes, useTheme } from '@emotion/react';
import { colors, sim } from './config';
import type { Action, Belt } from './engine';

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const slide = keyframes`
  to {
    background-position: 20px 0;
  }
`;

export const fmt = (seconds: number) => {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped % 1) * 100);
  return `${mins}:${String(secs).padStart(2, '0')}:${String(centis).padStart(2, '0')}`;
};

const Row = styled.div`
  display: flex;
  gap: 14px;
  height: 112px;
  margin-bottom: 28px;
`;

const Panel = styled('div', {
  shouldForwardProp: (prop) => !['lightColor', 'darkColor', 'locked'].includes(prop),
})<{ lightColor: string; darkColor: string; locked: boolean }>`
  width: ${(p) => p.theme.belt.panel}px;
  height: ${(p) => p.theme.belt.panel}px;
  border-radius: 8px;
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  background: linear-gradient(${(p) => p.lightColor}, ${(p) => p.darkColor});
  border: 2px solid rgba(255, 255, 255, 0.55);
  pointer-events: ${(p) => (p.locked ? 'none' : 'auto')};
`;

const PanelButton = styled.button`
  border: 2px solid rgba(255, 255, 255, 0.8);
  background: transparent;
  color: #fff;
  border-radius: 6px;
  font-size: 20px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, transform 0.08s;
  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  &:active,
  &[data-active='true'] {
    background: #fff !important;
    color: #1a1a1a !important;
    border-color: #fff !important;
    transform: scale(0.94);
  }
`;

const Info = styled.div`
  width: ${(p) => p.theme.belt.length}px;
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 500;
  margin-top: 6px;
`;

const HeadRate = styled.span`
  color: ${(p) => p.theme.text};
`;

const HeadCount = styled.span`
  color: ${(p) => p.theme.text};
`;

const Lane = styled.div`
  position: relative;
  height: 56px;
`;

const Track = styled('div', {
  shouldForwardProp: (prop) => !['period', 'paused'].includes(prop),
})<{ period: number; paused: boolean }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 3px;
  height: ${(p) => p.theme.belt.trackHeight}px;
  border: 2px solid ${(p) => p.theme.line};
  border-radius: 10px;
  background: repeating-linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.28) 0 6px,
    transparent 6px 20px
  );
  animation: ${slide} ${(p) => p.period}s linear infinite;
  animation-play-state: ${(p) => (p.paused ? 'paused' : 'running')};
`;

const Wheels = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  padding: 0 1px;
`;

const Wheel = styled('span', {
  shouldForwardProp: (prop) => !['revSec', 'paused'].includes(prop),
})<{ revSec: number; paused: boolean }>`
  position: relative;
  width: ${(p) => p.theme.wheel.size}px;
  height: ${(p) => p.theme.wheel.size}px;
  border-radius: 50%;
  background: ${(p) => p.theme.panelBg};
  border: ${(p) => p.theme.wheel.border}px solid ${(p) => p.theme.line};
  animation: ${spin} ${(p) => p.revSec}s linear infinite;
  animation-play-state: ${(p) => (p.paused ? 'paused' : 'running')};
`;

const Spoke = styled('i', {
  shouldForwardProp: (prop) => prop !== 'rotation',
})<{ rotation: number }>`
  position: absolute;
  left: 50%;
  top: 0;
  width: 2px;
  height: 100%;
  margin-left: -1px;
  background: ${(p) => p.theme.line};
  transform: rotate(${(p) => p.rotation}deg);
`;

const Block = styled('div', {
  shouldForwardProp: (prop) =>
    !['progress', 'blockColor', 'blockWidth'].includes(prop),
})<{ progress: number; blockColor: string; blockWidth: number }>`
  position: absolute;
  bottom: ${(p) => p.theme.belt.trackHeight + 8}px;
  left: calc(
    ${(p) => p.progress * 100}% - ${(p) => p.progress * p.blockWidth}px
  );
  width: ${(p) => p.blockWidth}px;
  height: ${(p) => p.theme.belt.block}px;
  border-radius: 3px;
  background: ${(p) => p.blockColor};
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
`;

const Repair = styled.div`
  font-size: 13px;
  text-align: center;
  color: #ffd9d9;
  height: 20px;
  font-weight: 500;
`;

interface Props {
  index: number;
  belt: Belt;
  locked: boolean;
  pressed: Action | null;
  count: number;
  onAct: (beltIndex: number, action: Action) => void;
}

export default function BeltRow({
  index,
  belt,
  locked,
  pressed,
  count,
  onAct,
}: Props) {
  const { belt: beltTheme, wheel } = useTheme();
  const color = colors[index];
  const speedLevel = sim.speedLevels[belt.level];
  const paused = belt.down > 0;

  const renderButton = (action: Action, label: string, text: string) => (
    <PanelButton
      type="button"
      aria-label={`${color.name} ${label}`}
      data-active={pressed === action}
      onClick={() => onAct(index, action)}
    >
      {text}
    </PanelButton>
  );

  return (
    <Row>
      <Panel lightColor={color.light} darkColor={color.dark} locked={locked}>
        {renderButton('increase_speed', 'increase speed', '↑')}
        {renderButton('add_block', 'add block', '+')}
        {renderButton('decrease_speed', 'decrease speed', '↓')}
        {renderButton('remove_block', 'remove block', '−')}
      </Panel>
      <Info>
        <Head>
          <HeadRate>
            {belt.blocks} B / {speedLevel.interval}s (
            {(belt.blocks / speedLevel.interval).toFixed(2)}/s)
          </HeadRate>
          <HeadCount title={`${color.name} blocks in the container`}>
            {count} in box
          </HeadCount>
        </Head>
        <Lane>
          {belt.items
            .filter((position) => position >= 0)
            .map((position, itemIndex) => (
              <Block
                key={itemIndex}
                blockColor={color.light}
                progress={position}
                blockWidth={beltTheme.block}
              />
            ))}
          <Track
            period={(20 * speedLevel.travel) / beltTheme.length}
            paused={paused}
          />
          <Wheels>
            {Array.from({ length: wheel.count }, (_, wheelIndex) => (
              <Wheel
                key={wheelIndex}
                revSec={speedLevel.wheelRev}
                paused={paused}
              >
                {Array.from({ length: wheel.spokes }, (_, spokeIndex) => (
                  <Spoke
                    key={spokeIndex}
                    rotation={(spokeIndex * 180) / wheel.spokes}
                  />
                ))}
              </Wheel>
            ))}
          </Wheels>
        </Lane>
        <Repair>
          {paused ? `🔧 Under Repair (${fmt(belt.down)})` : ''}
        </Repair>
      </Info>
    </Row>
  );
}