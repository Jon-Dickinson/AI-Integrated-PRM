import { useState } from 'react';
import styled from '@emotion/styled';
import BeltRow, { fmt } from './BeltRow';
import ContainerView from './ContainerView';
import { colors } from './config';
import { capacity } from './engine';
import { useSim } from './useSim';

const Shell = styled('div', {
  shouldForwardProp: (prop) => prop !== 'open',
})<{ open: boolean }>`
  position: relative;
  height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
  transition: width ${(p) => p.theme.log.slideMs}ms ease;
  width: ${(p) =>
    p.open ? `calc(100% - ${p.theme.log.width}px)` : '100%'};
`;

const Top = styled.div`
  height: 48px;
  border-bottom: 2px solid #fff;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 22px;
  font-weight: 600;
  font-size: 18px;
`;

const TopBrand = styled.span`
  color: #fff;
  letter-spacing: 0.5px;
`;

const TopActions = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const DownloadZipLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.6);
  }
`;

const LogToggleButton = styled.button`
  background: none;
  border: 0;
  color: #fff;
  font-size: 26px;
  cursor: pointer;
  line-height: 1;
  padding: 4px;
  transition: opacity 0.15s;
  &:hover {
    opacity: 0.8;
  }
`;

const Title = styled.h1`
  font-size: 20px;
  font-weight: 500;
  margin: 16px 24px;
  color: #cfd8ee;
  letter-spacing: 0.3px;
`;

const Reset = styled.button`
  position: absolute;
  right: 22px;
  top: 68px;
  background: none;
  border: 0;
  color: #fff;
  font-size: 28px;
  cursor: pointer;
  line-height: 1;
  transition: transform 0.2s, opacity 0.15s;
  &:hover {
    transform: rotate(90deg);
    opacity: 0.85;
  }
`;

const Pills = styled.div`
  position: absolute;
  left: 24px;
  top: 108px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
  max-width: 280px;
`;

const Pill = styled('span', {
  shouldForwardProp: (prop) => prop !== 'bg',
})<{ bg: string }>`
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  background: ${(p) => p.bg};
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  display: inline-block;
  white-space: nowrap;
`;

const Why = styled.div`
  font-size: 12px;
  line-height: 1.45;
  color: ${(p) => p.theme.muted};
  background: rgba(2, 10, 38, 0.45);
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 3px solid #ffd27a;
`;

const Stage = styled.div`
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 10px;
  padding-bottom: 40px;
`;

const BeltColumn = styled.div`
  margin-top: 78px;
`;

const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  margin: 18px 0 6px -4px;
  font-size: 14px;
`;

const PatternTimer = styled.span`
  width: 70px;
  text-align: right;
  font-weight: 600;
`;

const Pattern = styled.div`
  display: flex;
  gap: 8px;
  border: 2px solid #fff;
  border-radius: 4px;
  padding: 6px 8px;
  background: rgba(2, 8, 25, 0.5);
`;

const PatternDot = styled('i', {
  shouldForwardProp: (prop) => prop !== 'dotColor',
})<{ dotColor: string }>`
  width: 22px;
  height: 22px;
  border-radius: 3px;
  display: block;
  background: ${(p) => p.dotColor};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;

const Mode = styled('button', {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active: boolean }>`
  width: 42px;
  height: 42px;
  border: 2px solid #fff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  background: ${(p) => (p.active ? '#fff' : 'transparent')};
  color: ${(p) => (p.active ? '#031033' : '#fff')};
  &:hover {
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
  }
`;

const Log = styled.aside<{ open: boolean }>`
  position: fixed;
  top: 0;
  right: 0;
  width: ${(p) => p.theme.log.width}px;
  height: 100vh;
  border-left: 2px solid #fff;
  background: ${(p) => p.theme.panelBg};
  transform: translateX(${(p) => (p.open ? 0 : 100)}%);
  transition: transform ${(p) => p.theme.log.slideMs}ms ease;
  overflow: auto;
  padding: 20px 22px;
  font-size: 14px;
  line-height: 1.65;
  z-index: 100;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.5);
`;

const LogHeading = styled.h3`
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 8px;
`;

const EmptyLogNotice = styled.div`
  color: ${(p) => p.theme.muted};
  font-style: italic;
`;

const Entry = styled.div`
  margin-bottom: 14px;
  line-height: 1.4;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

const EntryTitle = styled.b`
  display: block;
  color: #fff;
  font-size: 14px;
`;

const EntryMeta = styled.small`
  display: block;
  color: ${(p) => p.theme.muted};
  font-size: 12px;
  margin-top: 3px;
`;

export default function App() {
  const { state, mode, ai, press, setMode, act, reset } = useSim();
  const [logOpen, setLogOpen] = useState(false);

  const capacityPercent = Math.round((state.fill.length / capacity) * 100);
  const repairingBeltIndex = state.belts.findIndex((belt) => belt.down > 0);

  const containerCounts = colors.map(() => 0);
  state.fill.forEach((colorIndex) => {
    containerCounts[colorIndex]++;
  });

  const capacityPillColor =
    capacityPercent > 75
      ? '#ff9b9b'
      : capacityPercent > 50
        ? '#ffd27a'
        : '#9be39b';

  return (
    <>
      <Shell open={logOpen}>
        <Top>
          <TopBrand>⚙ PRM</TopBrand>
          <TopActions>
            <LogToggleButton
              type="button"
              aria-label="Action log"
              title="Toggle Action Log"
              onClick={() => setLogOpen((prev) => !prev)}
            >
              ☰
            </LogToggleButton>
          </TopActions>
        </Top>

        <Reset
          type="button"
          aria-label="Reset simulation"
          title="Reset Simulation"
          onClick={reset}
        >
          ⟳
        </Reset>
        <Title>Production and Resource-Management</Title>

        <Pills>
          <Pill bg="#ffd27a">
            {mode === 'ai'
              ? `AI Management Active${ai.source ? ` · ${ai.source}` : ''}`
              : 'Manual Control'}
          </Pill>
          <Pill bg={capacityPillColor}>{capacityPercent}% Capacity</Pill>
          {repairingBeltIndex >= 0 && (
            <Pill bg="#ffd0d0">
              {colors[repairingBeltIndex].name} Belt Active Repairs
            </Pill>
          )}
          {mode === 'ai' && ai.why && <Why>{ai.why}</Why>}
        </Pills>

        <Stage>
          <BeltColumn>
            {state.belts.map((belt, beltIndex) => (
              <BeltRow
                key={beltIndex}
                index={beltIndex}
                belt={belt}
                locked={mode === 'ai'}
                pressed={
                  press && press.belt === beltIndex ? press.action : null
                }
                count={containerCounts[beltIndex]}
                onAct={act}
              />
            ))}
          </BeltColumn>
          <RightColumn>
            <Bar>
              <PatternTimer>{fmt(state.patternLeft)}</PatternTimer>
              <Pattern>
                {state.pattern.map((colorIndex, patternIndex) => (
                  <PatternDot
                    key={patternIndex}
                    dotColor={colors[colorIndex].light}
                  />
                ))}
              </Pattern>
              <Mode
                type="button"
                active={mode === 'manual'}
                title="Manual control"
                onClick={() => setMode('manual')}
              >
                ✋
              </Mode>
              <Mode
                type="button"
                active={mode === 'ai'}
                title="AI control"
                onClick={() => setMode('ai')}
              >
                AI
              </Mode>
            </Bar>
            <ContainerView
              state={state}
              onReset={reset}
              label={
                mode === 'ai' ? 'Mode: AI control' : 'Mode: manual control'
              }
            />
          </RightColumn>
        </Stage>
      </Shell>

      <Log open={logOpen}>
        <LogHeading>Action Log</LogHeading>
        {state.log.length === 0 ? (
          <EmptyLogNotice>No actions recorded yet.</EmptyLogNotice>
        ) : (
          state.log.map((entry, entryIndex) => (
            <Entry key={state.log.length - entryIndex}>
              <EntryTitle>{entry.text}</EntryTitle>
              <EntryMeta>
                {entry.who} · {Math.floor(entry.t)}s
                {entry.why ? ` · ${entry.why}` : ''}
              </EntryMeta>
            </Entry>
          ))
        )}
      </Log>
    </>
  );
}