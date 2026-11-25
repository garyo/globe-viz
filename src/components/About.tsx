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
          This application visualizes daily global temperature data from two
          independent climate-data sources: NOAA's <strong>OISST</strong>
          (Optimally Interpolated Sea Surface Temperature) — sea-surface
          temperatures only — and ECMWF's <strong>ERA5</strong> reanalysis,
          which adds 2 m air temperature over land. Use the source toggle in
          the header to switch between them. Within each source you can view
          absolute temperatures or (for OISST) the temperature anomaly —
          the deviation from the long-term average for that date and location —
          to see how ocean temperatures are changing over time.
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
            Click any point on the globe to read its coordinates, place name,
            and every source's value there for the current date, exact to
            0.01 °C for the 0.25° grid cell. Place names come from bundled Natural Earth outlines, refined for
            land points by{' '}
            <a href="https://www.bigdatacloud.com/" target="_blank" rel="noopener noreferrer">
              BigDataCloud
            </a>
            's free reverse geocoder — which receives the clicked coordinates.
          </li>
          <li>
            <strong>Keyboard Shortcuts (Globe tab):</strong>
            <ul style="margin-top: 0.5em;">
              <li><strong>Spacebar</strong> — Play/Pause animation</li>
              <li><strong>Left/Right Arrows</strong> — Navigate backward/forward one day</li>
              <li><strong>R</strong> — Toggle auto-rotation on/off</li>
              <li><strong>A</strong> — Toggle Actual / Anomaly (hold to peek, release to snap back)</li>
              <li><strong>V</strong> — Switch variable (sea / air temperature)</li>
              <li><strong>S</strong> — Switch data source (OISST / ERA5)</li>
              <li><strong>L</strong> — Loop playback from the current date (press again to clear)</li>
              <li><strong>Esc</strong> — Close the point readout</li>
              <li><strong>?</strong> — Open this About tab</li>
            </ul>
          </li>
        </ul>
        <p>
          <strong>Data Sources:</strong>
        </p>
        <ul>
          <li>
            <strong>NOAA OISST</strong> — daily 0.25° gridded sea-surface
            temperatures, blended from satellite + buoy observations. Used
            for the SST and Anomaly views.{' '}
            <a
              href="https://www.ncei.noaa.gov/products/climate-data-records/sea-surface-temperature-optimum-interpolation"
              target="_blank"
              rel="noreferrer"
            >
              About OISST
            </a>.
          </li>
          <li>
            <strong>ECMWF ERA5</strong> — global atmospheric reanalysis at
            0.25° resolution. We pull SST and 2 m air temperature at 12:00 UTC
            daily and resample onto the OISST grid so the two sources are
            directly comparable.{' '}
            <a
              href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels"
              target="_blank"
              rel="noreferrer"
            >
              About ERA5
            </a>.
          </li>
        </ul>
        <p>
          Both feeds are processed by the upstream climate-data pipeline and
          hosted on AWS S3. The color maps go from cold (blue/purple) to warm
          (orange/red and beyond); each dataset has its own appropriate range.
        </p>

        <h3 style="margin-top: 1.8em">Regions on the Trends tab</h3>
        <p>
          The Trends tab lets you explore time series for ten regions: a global
          ocean average (60°S–60°N), the tropics (±23.5°), each hemisphere, the
          Niño 3.4 box used in ENSO indices, and the five major ocean basins.
          Air temperature also has a whole-globe average (pole to pole, from
          2014 on), comparable to the global figures Copernicus publishes; sea
          surface temperature has none, since the polar oceans are mostly sea
          ice.
        </p>
        <img
          src="/regions-map.png"
          alt="World map showing the ten regions used in the Trends tab — five ocean basins as colored areas plus bbox overlays for global, tropics, hemispheres, and Niño 3.4."
          class="about-figure"
        />
        <p>
          Basin boundaries broadly follow the IHO <em>Limits of Oceans and
          Seas</em>, including each ocean's open marginal seas (Bering, Sea of
          Japan, Coral Sea for the Pacific; Caribbean, Gulf of Mexico,
          Norwegian Sea for the Atlantic; Barents, Kara, Laptev, Beaufort for
          the Arctic; etc.). Semi-enclosed or climatically distinct bodies —
          Mediterranean, Baltic, Black Sea, Hudson Bay, Red Sea, Persian Gulf —
          are deliberately excluded so the basin means reflect open-ocean
          dynamics rather than the very different conditions of enclosed seas.
          Each regional average is area-weighted (cells near the equator count
          more than cells near the poles, in proportion to the area each grid
          cell actually covers on Earth).
        </p>
        <h3 style="margin-top: 1.8em">Anomaly baselines</h3>
        <p>
          An anomaly is the difference from the long-term average for the same
          place and time of year. The Anomaly selector in the Datasets panel
          picks the reference period, for the globe and the graphs alike:
        </p>
        <ul>
          <li>
            <strong>1971–2000</strong> — OISST's published anomaly (NOAA's own
            climatology), and an ERA5 climatology for ERA5 and GFS.
          </li>
          <li>
            <strong>1991–2020</strong> — the current WMO climate normal, from
            NOAA's OISST climatologies for OISST and ERA5 monthly means for
            ERA5 and GFS.
          </li>
          <li>
            <strong>Pre-industrial (1850–1900)</strong> — the IPCC reference
            for warming targets such as 1.5 °C. No satellite or reanalysis
            record reaches that far back, so each source's 1991–2020 anomaly is
            shifted by the 1991–2020 vs. 1850–1900 difference from long-record
            reconstructions: the average of{' '}
            <a href="https://berkeleyearth.org/data/" target="_blank" rel="noreferrer">Berkeley Earth</a>,{' '}
            <a href="https://www.metoffice.gov.uk/hadobs/hadcrut5/" target="_blank" rel="noreferrer">HadCRUT5</a>{' '}
            and{' '}
            <a href="https://www.ncei.noaa.gov/products/land-based-station/noaa-global-temp" target="_blank" rel="noreferrer">NOAAGlobalTemp</a>{' '}
            for air temperature (the three Copernicus uses), and of{' '}
            <a href="https://www.ncei.noaa.gov/products/extended-reconstructed-sst" target="_blank" rel="noreferrer">ERSSTv6</a>{' '}
            and{' '}
            <a href="https://psl.noaa.gov/data/gridded/data.cobe2.html" target="_blank" rel="noreferrer">COBE-SST2</a>{' '}
            for sea-surface temperature.
          </li>
        </ul>
        <p>
          Each baseline shifts a region's curve by an amount that varies
          smoothly through the year but is the same every year, so it changes
          the zero line, not the shape. The pre-industrial shift is an
          estimate: observations before 1900 were sparse, especially in the
          Southern Hemisphere and polar oceans, so it's smoothed to scales of
          roughly 500 km, and the reconstructions disagree by about 0.1 °C
          globally (early ship measurements are a known source of bias). Over
          the ocean, the air-temperature shift comes from blended records that
          use sea-surface temperature there, which the IPCC puts within 10% of
          true air-temperature warming. Our "Global" region spans 60°S–60°N,
          so its figures won't exactly match whole-planet numbers such as
          Copernicus's. The full method, datasets, math, and validation are
          documented{' '}
          <a
            href="https://github.com/garyo/sea-surface-temp-viz/blob/main/doc/baselines.md"
            target="_blank"
            rel="noreferrer"
          >
            here
          </a>.
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
