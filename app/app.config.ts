export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', neutral: 'stone' },
    button: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class:
            'text-primary-900 bg-primary-300 hover:bg-primary-300/75 active:bg-primary-300/75 disabled:bg-primary-300 aria-disabled:bg-primary-300',
        },
      ],
    },
    // Modals grow from their trigger (main.css, plugins/motion.client.ts) instead of Nuxt UI's scale from the center.
    modal: {
      slots: { content: 'modal-motion' },
      variants: {
        transition: {
          true: {
            content:
              'data-[state=open]:animate-[modal-in_var(--motion-base)_var(--motion-ease-enter)] data-[state=closed]:animate-[modal-out_var(--motion-base)_var(--motion-ease-exit)]',
          },
        },
      },
    },
  },
})
