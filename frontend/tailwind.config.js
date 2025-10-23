// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'box-move0': 'boxMove0 3s linear forwards infinite',
        'box-scale0': 'boxScale0 3s ease forwards infinite',
        // Add more animations for other boxes...
        'ground': 'ground 3s linear forwards infinite',
        'ground-shine': 'groundShine 3s linear forwards infinite',
        'mask': 'mask 3s linear forwards infinite',
      },
      keyframes: {
        boxMove0: {
          '12%': { transform: 'translate(var(--x), var(--y))' },
          '25%, 52%': { transform: 'translate(0, 0)' },
          '80%': { transform: 'translate(0, -32px)' },
          '90%, 100%': { transform: 'translate(0, 188px)' },
        },
        boxScale0: {
          '6%': { transform: 'rotateY(-47deg) rotateX(-15deg) rotateZ(15deg) scale(0)' },
          '14%, 100%': { transform: 'rotateY(-47deg) rotateX(-15deg) rotateZ(15deg) scale(1)' },
        },
        ground: {
          '0%, 65%': { transform: 'rotateX(90deg) rotateY(0deg) translate(-48px, -120px) translateZ(100px) scale(0)' },
          '75%, 90%': { transform: 'rotateX(90deg) rotateY(0deg) translate(-48px, -120px) translateZ(100px) scale(1)' },
          '100%': { transform: 'rotateX(90deg) rotateY(0deg) translate(-48px, -120px) translateZ(100px) scale(0)' },
        },
        groundShine: {
          '0%, 70%': { opacity: '0' },
          '75%, 87%': { opacity: '0.2' },
          '100%': { opacity: '0' },
        },
        mask: {
          '0%, 65%': { opacity: '0' },
          '66%, 100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};