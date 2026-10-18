# PRM - Production & Resource Management

Conveyor belt simulation with real-time AI optimization powered by Google Gemini LLM.

## Features
- **4 Conveyor Belts**: Yellow, Red, Green, and Blue belts with configurable speed and batch sizes.
- **Dynamic Pattern Matching**: Automatic container depletion whenever matching sets of colored blocks arrive.
- **Random Belt Breakdowns**: Realistic maintenance downtime events requiring speed rebalancing.
- **Dual-Mode Control**:
  - **Manual Control**: Directly adjust throughput per belt.
  - **LLM Management**: Real-time Gemini model analysis that balances conveyor throughput to minimize overflow risk.
- **Live Action Log**: Displays model-generated reasoning for every speed and batch adjustment.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure your Gemini API key in `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-3.8-flash
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.
