// Tour: scripts with several results, pinning and comparing them, on the demo tables (docs: editor/running-queries,
// data/result-grid)
const SCRIPT = `select city, count(*) as customers from customers group by city order by city;

select p.name as product, sum(o.quantity) as sold
from orders o
join products p on p.id = o.product_id
group by p.name
order by sold desc;
`

export default defineTour({
  id: 'results-advanced',
  category: 'data',
  priority: 60,
  steps: () => {
    const { openTab, runTab } = useDemo()
    return [
      { key: 'script', target: tourTarget('editor'), side: 'bottom', before: () => openTab(SCRIPT) },
      { key: 'switch', target: tourTarget('result-switcher'), side: 'bottom', before: runTab },
      { key: 'pin', target: tourTarget('result-switcher'), side: 'bottom' },
      { key: 'detail', target: () => tourTarget('grid')()?.querySelector('tbody tr'), side: 'bottom' },
    ]
  },
})
