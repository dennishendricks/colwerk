export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', neutral: 'stone' },
    button: {
      compoundVariants: [{
        color: 'primary',
        variant: 'solid',
        class: 'text-primary-900 bg-primary-300 hover:bg-primary-300/75 active:bg-primary-300/75 disabled:bg-primary-300 aria-disabled:bg-primary-300',
      }],
    },
  },
})
