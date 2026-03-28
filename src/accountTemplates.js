export const PROP_FIRM_TEMPLATE_CONFIG = [
  {
    id: "apex",
    label: "Apex Trader Funding",
    templates: [
      { id: "apex-25k", label: "PA 25K", firmName: "Apex Trader Funding", dailyLossLimit: 625, maxDrawdown: 1500, profitTarget: 1500, status: "active" },
      { id: "apex-50k", label: "PA 50K", firmName: "Apex Trader Funding", dailyLossLimit: 1250, maxDrawdown: 2500, profitTarget: 3000, status: "active" },
      { id: "apex-100k", label: "PA 100K", firmName: "Apex Trader Funding", dailyLossLimit: 2500, maxDrawdown: 3500, profitTarget: 6000, status: "active" },
    ],
  },
  {
    id: "topstep",
    label: "Topstep",
    templates: [
      { id: "topstep-50k", label: "Combine 50K", firmName: "Topstep", dailyLossLimit: 1000, maxDrawdown: 2000, profitTarget: 3000, status: "active" },
      { id: "topstep-100k", label: "Combine 100K", firmName: "Topstep", dailyLossLimit: 2000, maxDrawdown: 3000, profitTarget: 6000, status: "active" },
      { id: "topstep-150k", label: "Combine 150K", firmName: "Topstep", dailyLossLimit: 3000, maxDrawdown: 4500, profitTarget: 9000, status: "active" },
    ],
  },
  {
    id: "tpt",
    label: "Take Profit Trader",
    templates: [
      { id: "tpt-50k", label: "PRO 50K", firmName: "Take Profit Trader", dailyLossLimit: 1000, maxDrawdown: 2000, profitTarget: 3000, status: "active" },
      { id: "tpt-75k", label: "PRO 75K", firmName: "Take Profit Trader", dailyLossLimit: 1500, maxDrawdown: 2500, profitTarget: 4500, status: "active" },
      { id: "tpt-100k", label: "PRO 100K", firmName: "Take Profit Trader", dailyLossLimit: 2000, maxDrawdown: 3500, profitTarget: 6000, status: "active" },
    ],
  },
];
