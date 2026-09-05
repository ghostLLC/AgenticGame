/** A code-native schematic of the selected chassis, shared by the dashboard and garage. */
export function tankIllustrationV1(vehicleId: string, label: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 480 300');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}的俯视示意图`);
  svg.classList.add('tank-illustration');
  svg.dataset.chassis = vehicleId;
  // Static authored geometry; labels and player input are assigned with textContent outside SVG.
  svg.innerHTML = `<g class="schematic-grid" fill="none" stroke="currentColor"><path d="M0 75H480M0 150H480M0 225H480M120 0V300M240 0V300M360 0V300"/><circle cx="240" cy="162" r="112"/><path d="M100 162H150M330 162H380M240 24V55M240 270V292"/></g>
    <g class="tank-body" transform="translate(240 162) rotate(28)">
      <rect class="track" x="-73" y="-80" width="29" height="168" rx="12"/><rect class="track" x="44" y="-80" width="29" height="168" rx="12"/>
      <path class="track-detail" d="M-71-60H-46M-71-40H-46M-71-20H-46M-71 0H-46M-71 20H-46M-71 40H-46M-71 60H-46M46-60H71M46-40H71M46-20H71M46 0H71M46 20H71M46 40H71M46 60H71"/>
      <path class="hull" d="M-39-86H39L53-54V66L38 84H-38L-53 66V-54Z"/>
      <path class="armor-detail" d="M-38-71H38M-39 58H39M-39 67H39M-32-64V-44M32-64V-44"/>
      <rect class="turret" x="-30" y="-39" width="60" height="73" rx="17"/>
      <circle class="hatch" cx="0" cy="12" r="12"/>
      <path class="barrel" d="M-6-28V-118H6V-28Z"/><path class="barrel-end" d="M-9-118H9V-103H-9Z"/>
    </g>`;
  return svg;
}
