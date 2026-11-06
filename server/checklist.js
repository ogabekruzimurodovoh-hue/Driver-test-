// Inspection template. Edit items here; "critical" failures mark the truck out of service.
// Align the list and critical flags with your company policy and FMCSA rules (49 CFR 396.11/396.13).

export const CHECKLIST = [
  {
    id: 'brakes', title: 'Brakes',
    items: [
      { key: 'service_brakes', label: 'Service brakes', critical: true },
      { key: 'parking_brake', label: 'Parking brake', critical: true },
      { key: 'air_system', label: 'Air lines & glad hands', critical: true },
    ],
  },
  {
    id: 'tires', title: 'Tires & wheels',
    items: [
      { key: 'tread_depth', label: 'Tread depth', critical: true },
      { key: 'tire_condition', label: 'Sidewalls & inflation', critical: true },
      { key: 'lug_nuts', label: 'Lug nuts & rims', critical: true },
    ],
  },
  {
    id: 'lights', title: 'Lights & signals',
    items: [
      { key: 'headlights', label: 'Headlights', critical: false },
      { key: 'turn_signals', label: 'Turn signals', critical: false },
      { key: 'brake_lights', label: 'Brake lights', critical: true },
      { key: 'marker_lights', label: 'Marker & clearance lights', critical: false },
    ],
  },
  {
    id: 'visibility', title: 'Mirrors & glass',
    items: [
      { key: 'mirrors', label: 'Mirrors', critical: false },
      { key: 'windshield', label: 'Windshield (no cracks in driver view)', critical: true },
      { key: 'wipers', label: 'Wipers & washer', critical: false },
    ],
  },
  {
    id: 'steering', title: 'Steering & suspension',
    items: [
      { key: 'steering', label: 'Steering play', critical: true },
      { key: 'suspension', label: 'Springs & suspension', critical: true },
      { key: 'leaks', label: 'Fluid leaks underneath', critical: false },
    ],
  },
  {
    id: 'coupling', title: 'Coupling',
    items: [
      { key: 'fifth_wheel', label: 'Fifth wheel & kingpin', critical: true },
      { key: 'trailer_connections', label: 'Trailer air & electrical connections', critical: true },
    ],
  },
  {
    id: 'engine', title: 'Engine & fluids',
    items: [
      { key: 'oil', label: 'Oil level', critical: false },
      { key: 'coolant', label: 'Coolant level', critical: false },
      { key: 'belts_hoses', label: 'Belts & hoses', critical: false },
      { key: 'battery', label: 'Battery & terminals', critical: false },
    ],
  },
  {
    id: 'cab', title: 'Cab & safety equipment',
    items: [
      { key: 'horn', label: 'Horn', critical: false },
      { key: 'seat_belt', label: 'Seat belt', critical: true },
      { key: 'fire_extinguisher', label: 'Fire extinguisher', critical: true },
      { key: 'warning_triangles', label: 'Warning triangles', critical: true },
      { key: 'first_aid', label: 'First-aid kit', critical: false },
    ],
  },
  {
    id: 'documents', title: 'Documents',
    items: [
      { key: 'registration', label: 'Registration in cab', critical: false },
      { key: 'insurance', label: 'Insurance card in cab', critical: false },
      { key: 'dvir', label: 'Previous DVIR signed off', critical: false },
    ],
  },
];

// Photo slots. The four sides + dashboard + driver seat are required.
export const PHOTO_SLOTS = {
  front: 'Front',
  right: 'Right side',
  rear: 'Rear',
  left: 'Left side',
  interior_dash: 'Dashboard',
  interior_cab: 'Driver seat',
  interior_sleeper: 'Sleeper (optional)',
};

export const REQUIRED_PHOTOS = ['front', 'right', 'rear', 'left', 'interior_dash', 'interior_cab'];

export const STATUS_LABEL = {
  ready: 'Ready',
  needs_attention: 'Needs attention',
  out_of_service: 'Out of service',
  in_progress: 'In progress',
  unknown: 'Not inspected',
};

export function allItems() {
  return CHECKLIST.flatMap((section) => section.items);
}

/**
 * answers: { [itemKey]: 'pass' | 'fail' | 'na' }
 * status: in_progress (unanswered items) | out_of_service (critical fail)
 *         | needs_attention (any fail) | ready
 */
export function evaluateChecklist(answers = {}) {
  const items = allItems();
  const unanswered = items
    .filter((i) => !['pass', 'fail', 'na'].includes(answers[i.key]))
    .map((i) => i.key);
  const failed = items.filter((i) => answers[i.key] === 'fail');

  let status = 'ready';
  if (unanswered.length) status = 'in_progress';
  else if (failed.some((i) => i.critical)) status = 'out_of_service';
  else if (failed.length) status = 'needs_attention';

  return {
    status,
    failed: failed.map((i) => ({ key: i.key, label: i.label, critical: i.critical })),
    unanswered,
    answered: items.length - unanswered.length,
    total: items.length,
  };
}
