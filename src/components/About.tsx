export const About = () => {
  return (
    <div class="about-tab">
      <div class="about-content">
        <h2>About This App</h2>
        <p>
          The oceans are the reservoirs of the world's heat. Much of the excess heat
          entering the earth since the dawn of the industrial age has gone into the oceans;
          they are now reaching the limits of their ability to absorb heat and CO₂ without
          triggering climate "tipping points." Increased ocean temperatures affect coral reefs,
          change how ocean currents flow, and provide more energy for hurricanes and typhoons.
          Monitoring ocean temperatures is an important part of climate science;
          this application lets everyone peer into that data
          and see what's happening across the globe and across time.
        </p>
        <p>
          This application visualizes daily global sea surface temperature data
          from NASA's OISST (Optimally Interpolated Sea Surface Temperature) dataset.
          You can view absolute temperatures or temperature anomalies (deviations from
          the long-term average for that date and location) to see how ocean
          temperatures are changing over time.
        </p>
        <p>
          You can see the current state of warming of the global sea surface temperatures,
          and focus on any region of interest. Use the mouse and wheel or touchpad
          to zoom and pan. You should be able to see El Niño and La Niña phases forming and
          dissipating over time in the tropical Pacific, as well as the impact of hurricanes
          and typhoons and other phenomena.
        </p>
        <p>
          Note that in the anomaly dataset, the warm side of the color map
          goes more than twice as far from 0°C as the cold side.
          Due to global warming, the warmest sea surface temp anomalies are now well
          over double the coldest ones.
        </p>
        <p>
          <strong>Features:</strong>
        </p>
        <ul>
          <li>Interactive 3D globe showing global ocean temperatures</li>
          <li>Shows absolute temperature and temp anomalies</li>
          <li>View historical data by date</li>
          <li>Animate through time to see temperature trends</li>
          <li>Auto-rotate and zoom via interactive camera controls</li>
          <li>Horizontal mouse wheel to rotate the globe left/right</li>
          <li>
            <strong>Keyboard Shortcuts (Globe tab):</strong>
            <ul style="margin-top: 0.5em;">
              <li><strong>Spacebar</strong> — Play/Pause animation</li>
              <li><strong>Left/Right Arrows</strong> — Navigate backward/forward one day</li>
              <li><strong>R</strong> — Toggle auto-rotation on/off</li>
              <li><strong>T</strong> — Switch between Temperature and Temp Anomaly datasets</li>
              <li><strong>?</strong> — Open this About tab</li>
            </ul>
          </li>
        </ul>
        <p>
          <strong>Data Source:</strong> NASA OISST daily 0.25° resolution data,
          processed by the sea-surface-temp-viz project and hosted on AWS S3.
          The color maps show temperature ranges from cold (blue/purple) to warm (orange/red and beyond).
        </p>
        <p>
          This is an open-source project under the MIT license.<br />
          Data generator:{' '}
          <a href="https://github.com/garyo/sea-surface-temp-viz" target="_blank" rel="noreferrer">
            View source code on GitHub
          </a>
          <br />
          This 3D Globe viewer:{' '}
          <a href="https://github.com/garyo/globe-viz" target="_blank" rel="noreferrer">
            View source code on GitHub
          </a>
        </p>
        <p style="font-size: 0.9rem; margin-top: 20px;">
          Created by{' '}
          <a href="https://oberbrunner.com" target="_blank" rel="noreferrer">
            Gary Oberbrunner
          </a>
          , © 2025
        </p>
      </div>
    </div>
  );
};
